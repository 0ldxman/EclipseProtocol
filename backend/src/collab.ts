/**
 * Minimal Yjs sync server.
 *
 * y-websocket ships a ready-made server, but it hides connection handling
 * behind a bin/ script that is awkward to reach from TypeScript and gives no
 * hook for the things this project needs anyway - checking a token before
 * letting a client into a room, and controlling how the document is persisted.
 * The wire protocol is small enough that implementing it directly is the
 * simpler option.
 *
 * Protocol: every frame starts with a varuint message type.
 *   0 = sync      - handed to y-protocols/sync, which handles the whole
 *                   state-vector/update handshake
 *   1 = awareness - ephemeral presence (cursors, who is painting where);
 *                   never persisted
 *
 * Documents are debounce-saved to disk as a full Yjs update. Yjs updates are
 * order-independent and idempotent, so a snapshot written at any moment
 * restores correctly - no journal replay needed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { WebSocket } from "ws";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const SAVE_DEBOUNCE_MS = 2_000;

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly sockets = new Set<WebSocket>();
  private saveTimer: NodeJS.Timeout | null = null;
  private loaded = false;

  /**
   * Called after the debounced save. Used to derive artefacts from the
   * document - writing a record out as markdown, refreshing a search index -
   * without the room needing to know what kind of document it holds.
   */
  onPersist: (() => Promise<void>) | null = null;

  constructor(readonly name: string, private readonly storeDir: string) {
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | null);
      this.scheduleSave();
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | null);
      },
    );
  }

  private get file(): string {
    return path.join(this.storeDir, `${this.name}.ydoc`);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const bytes = await readFile(this.file);
      Y.applyUpdate(this.doc, new Uint8Array(bytes), "storage");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
    await writeFile(this.file, Y.encodeStateAsUpdate(this.doc));
    await this.onPersist?.();
  }

  private broadcast(payload: Uint8Array, except: WebSocket | null): void {
    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  addConnection(socket: WebSocket): void {
    this.sockets.add(socket);

    // Step 1 of the handshake: tell the client what we have, so it can reply
    // with whatever we are missing.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    socket.send(encoding.toUint8Array(encoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      socket.send(encoding.toUint8Array(aw));
    }

    socket.on("message", (data: ArrayBufferLike) => {
      const message = new Uint8Array(data as ArrayBuffer);
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();

      switch (decoding.readVarUint(decoder)) {
        case MESSAGE_SYNC: {
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          // `socket` as origin keeps the update from being echoed back to the
          // sender by the doc "update" handler above.
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket);
          if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            socket,
          );
          break;
        }
      }
    });

    const drop = () => {
      this.sockets.delete(socket);
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [...this.awareness.getStates().keys()].filter(
          (id) => id !== this.doc.clientID && this.sockets.size === 0,
        ),
        null,
      );
    };
    socket.on("close", drop);
    socket.on("error", drop);
  }

  get connectionCount(): number {
    return this.sockets.size;
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly storeDir: string) {}

  async get(name: string): Promise<Room> {
    let room = this.rooms.get(name);
    if (!room) {
      room = new Room(name, this.storeDir);
      this.rooms.set(name, room);
      await room.load();
    }
    return room;
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((r) => r.save()));
  }

  stats(): Array<{ name: string; connections: number }> {
    return [...this.rooms.values()].map((r) => ({
      name: r.name,
      connections: r.connectionCount,
    }));
  }
}
