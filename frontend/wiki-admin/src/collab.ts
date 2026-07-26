/**
 * Client side of the Yjs sync protocol - the mirror of backend/src/collab.ts.
 *
 * Written out rather than pulled from y-websocket because the served page may
 * sit behind a path-rewriting proxy, so the socket URL has to be derived from
 * wherever the page itself was loaded from, and because reconnection needs to
 * be visible to the UI rather than silent.
 */

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { baseDir } from "./base-path";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export type ConnectionState = "connecting" | "online" | "offline";

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export class CollabClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);

  private socket: WebSocket | null = null;
  private retry = 0;
  private closed = false;

  onStateChange: ((state: ConnectionState) => void) | null = null;

  constructor(private readonly url: string) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // came from the server, do not echo back
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.send(encoding.toUint8Array(encoder));
    });

    this.awareness.on("update", ({ added, updated, removed }: AwarenessChange) => {
      const changed = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      this.send(encoding.toUint8Array(encoder));
    });

    this.connect();
  }

  private setState(state: ConnectionState): void {
    this.onStateChange?.(state);
  }

  private connect(): void {
    if (this.closed) return;
    this.setState("connecting");

    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.setState("online");
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      socket.send(encoding.toUint8Array(encoder));

      const local = this.awareness.getLocalState();
      if (local) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          aw,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        socket.send(encoding.toUint8Array(aw));
      }
    };

    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const encoder = encoding.createEncoder();
      switch (decoding.readVarUint(decoder)) {
        case MESSAGE_SYNC: {
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_AWARENESS: {
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this,
          );
          break;
        }
      }
    };

    const reconnect = () => {
      if (this.closed) return;
      this.setState("offline");
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 250 * 2 ** this.retry);
    };
    socket.onclose = reconnect;
    socket.onerror = () => socket.close();
  }

  private send(payload: Uint8Array): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
  }

  destroy(): void {
    this.closed = true;
    this.socket?.close();
    this.doc.destroy();
  }
}

/**
 * Socket URL for a room.
 *
 * Takes an explicit API root rather than deriving one, because this app is
 * served from a subdirectory (`/admin/`) while the API and the collab sockets
 * live one level above it. Deriving from the page path would look for
 * `/admin/collab/...`, which does not exist.
 */
export function collabUrl(room: string, apiBase?: string): string {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  url.pathname = `${apiBase ?? baseDir(url.pathname)}/collab/${room}`;
  return url.toString();
}
