/**
 * Record routes: the tree, live document rooms, and rendering.
 *
 * A record's text lives in a Yjs `Y.Text` so several editors can work in it at
 * once, and is materialised to a real `.md` file on disk shortly after every
 * change. That materialised file is not a cache to be tolerated - it is the
 * point. The admin is a file manager over markdown documents, so the documents
 * have to exist as markdown: greppable, diffable, backupable, and readable by
 * anything that is not this application.
 *
 * Rendering happens here rather than in the browser because the server needs
 * the parsed form regardless - for the link graph, search, and for redacting
 * what a reader is not cleared to see. The editor previews by asking for it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderMarkup } from "@aether/markup";
import type { FastifyInstance } from "fastify";
import type * as Y from "yjs";
import type { RoomRegistry } from "./collab.js";
import { TreeError, TreeStore } from "./tree.js";

/** Room name carrying a record's live text. */
export const recordRoom = (id: string): string => `record.${id}`;

export interface RecordsOptions {
  tree: TreeStore;
  rooms: RoomRegistry;
  markdownDir: string;
}

export async function registerRecords(
  app: FastifyInstance,
  options: RecordsOptions,
): Promise<void> {
  const { tree, rooms, markdownDir } = options;

  const textOf = (doc: Y.Doc): string => doc.getText("content").toString();

  /**
   * Write the document out as markdown.
   *
   * Named by slug, not by id: the file on disk should be the thing a human
   * recognises. Moving a record between folders deliberately does not move the
   * file - location is tree metadata, identity is the slug, and keeping the two
   * apart is what lets the tree be reorganised without breaking links.
   */
  async function materialise(slug: string, markdown: string): Promise<void> {
    await mkdir(markdownDir, { recursive: true });
    await writeFile(path.join(markdownDir, `${slug}.md`), markdown, "utf8");
  }

  async function attachMaterialiser(recordId: string, slug: string): Promise<void> {
    const room = await rooms.get(recordRoom(recordId));
    if (room.onPersist) return; // already attached

    /*
     * Пустая комната рядом с непустым файлом означает потерянный снимок Yjs:
     * снимки живут в томе и восстановлению не подлежат, а материализованный
     * markdown объявлен долговечной формой записи. Поднимаем текст из файла —
     * иначе первое же сохранение затрёт файл пустотой, то есть потеря снимка
     * превратится в потерю записи.
     */
    if (room.doc.getText("content").length === 0) {
      const node = tree.get(recordId);
      const file = path.join(markdownDir, `${node?.slug ?? slug}.md`);
      const markdown = await readFile(file, "utf8").catch(() => "");
      if (markdown.trim()) room.doc.getText("content").insert(0, markdown);
    }
    room.onPersist = async () => {
      const node = tree.get(recordId);
      await materialise(node?.slug ?? slug, textOf(room.doc));
    };
  }

  app.get("/api/tree", async () => {
    const nodes = tree.list().map((node) => ({
      ...node,
      effectiveAccess: tree.effectiveAccess(node.id),
    }));
    return { nodes };
  });

  app.post("/api/tree/nodes", async (req, reply) => {
    const body = req.body as { kind?: string; name?: string; parentId?: string | null };
    if (body.kind !== "folder" && body.kind !== "record") {
      return reply.code(400).send({ error: "kind must be folder or record" });
    }
    const node = await tree.create({
      kind: body.kind,
      name: body.name ?? "",
      parentId: body.parentId ?? null,
    });
    if (node.kind === "record" && node.slug) {
      await attachMaterialiser(node.id, node.slug);
      await materialise(node.slug, `# ${node.name}\n\n`);
      const room = await rooms.get(recordRoom(node.id));
      // Seed the document so a new record opens with its title already there.
      if (room.doc.getText("content").length === 0) {
        room.doc.getText("content").insert(0, `# ${node.name}\n\n`);
      }
    }
    return node;
  });

  app.patch("/api/tree/nodes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      slug?: string;
      tags?: string[];
      summary?: string;
      code?: string;
      eventAt?: string;
      eventEpoch?: string;
      eventSummary?: string;
      eventImage?: string;
      parentId?: string | null;
      order?: number;
      accessLevel?: number;
    };
    try {
      let node = tree.get(id);
      if (!node) return reply.code(404).send({ error: "not found" });
      if (body.name !== undefined) node = await tree.rename(id, body.name);
      if (body.slug !== undefined) node = await tree.setSlug(id, body.slug);
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) return reply.code(400).send({ error: "tags must be an array" });
        node = await tree.setTags(id, body.tags.map(String));
      }
      if (body.summary !== undefined) node = await tree.setSummary(id, String(body.summary));
      if (body.code !== undefined) node = await tree.setCode(id, String(body.code));
      // Поля события правятся по одному: подпись меняют, не пересылая дату.
      if (
        body.eventAt !== undefined ||
        body.eventEpoch !== undefined ||
        body.eventSummary !== undefined ||
        body.eventImage !== undefined
      ) {
        node = await tree.setEvent(id, {
          at: body.eventAt,
          epoch: body.eventEpoch,
          summary: body.eventSummary,
          image: body.eventImage,
        });
      }
      if (body.accessLevel !== undefined) node = await tree.setAccess(id, body.accessLevel);
      if (body.parentId !== undefined) node = await tree.move(id, body.parentId, body.order);
      // Порядок без папки — перестановка среди своих же соседей. Раньше такой
      // запрос принимался и не делал ничего, поэтому переложить запись выше
      // соседней было нельзя: перенос умел только менять папку.
      else if (body.order !== undefined) node = await tree.move(id, node.parentId, body.order);
      return node;
    } catch (error) {
      if (error instanceof TreeError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  app.delete("/api/tree/nodes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const removed = await tree.remove(id);
      return { removed };
    } catch (error) {
      if (error instanceof TreeError) return reply.code(error.status).send({ error: error.message });
      throw error;
    }
  });

  /** Live preview for the editor - the same renderer the public page uses. */
  app.post("/api/render", async (req) => {
    const { markdown } = req.body as { markdown?: string };
    return renderMarkup(markdown ?? "", { linkExists: (slug) => tree.hasSlug(slug) });
  });

  /** A record by slug, rendered, with its breadcrumb. */
  app.get("/api/records/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const node = tree.bySlug(slug);
    if (!node) return reply.code(404).send({ error: "not found" });

    const room = await rooms.get(recordRoom(node.id));
    const rendered = renderMarkup(textOf(room.doc), {
      linkExists: (target) => tree.hasSlug(target),
    });
    return {
      node,
      breadcrumb: tree.pathOf(node.id).map((n) => ({ id: n.id, name: n.name })),
      access: tree.effectiveAccess(node.id),
      ...rendered,
    };
  });

  /** Ensure every existing record has a materialiser after a restart. */
  for (const node of tree.list()) {
    if (node.kind === "record" && node.slug) await attachMaterialiser(node.id, node.slug);
  }
}
