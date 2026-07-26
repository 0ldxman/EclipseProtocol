/**
 * The public read side of the wiki.
 *
 * Separate from `records.ts` on purpose. That module is the editing surface -
 * it hands out whatever is in the live document. This one answers a reader, and
 * a reader is not necessarily cleared for everything: a record inside a
 * restricted folder is listed by name but its text is never put on the wire.
 * Redaction that happens in the browser is not redaction.
 *
 * Everything a reader needs beyond a single record - search, backlinks - comes
 * from an index over the materialised `.md` files rather than from the live
 * documents. Those files are the durable form of the wiki, and reading them
 * costs nothing compared to instantiating every record's CRDT to answer a
 * search for one word.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { renderMarkup, wikiLinkTargets } from "@aether/markup";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type * as Y from "yjs";
import type { RoomRegistry } from "./collab.js";
import { recordRoom } from "./records.js";
import type { TreeNode, TreeStore } from "./tree.js";

export interface WikiOptions {
  tree: TreeStore;
  rooms: RoomRegistry;
  markdownDir: string;
}

/**
 * The reader's clearance.
 *
 * There is no session yet in this build - the auth service lives elsewhere and
 * is not wired in - so every reader is anonymous and cleared for level 0. This
 * is the single place that has to change when it is wired in, and everything
 * downstream already asks the question.
 */
function clearanceOf(_req: FastifyRequest): number {
  return 0;
}

interface IndexEntry {
  id: string;
  slug: string;
  title: string;
  text: string;
  links: string[];
  access: number;
  updatedAt: string;
}

/** How long an index build is trusted before the files are re-read. */
const INDEX_TTL_MS = 3000;

class RecordIndex {
  private entries: IndexEntry[] = [];
  private builtAt = 0;
  private building: Promise<void> | null = null;

  constructor(
    private readonly tree: TreeStore,
    private readonly markdownDir: string,
  ) {}

  async fresh(): Promise<IndexEntry[]> {
    if (Date.now() - this.builtAt < INDEX_TTL_MS) return this.entries;
    // Concurrent requests share one build instead of each starting their own.
    this.building ??= this.build().finally(() => {
      this.building = null;
    });
    await this.building;
    return this.entries;
  }

  private async build(): Promise<void> {
    const records = this.tree.list().filter((node) => node.kind === "record" && node.slug);
    const entries = await Promise.all(
      records.map(async (node) => {
        const file = path.join(this.markdownDir, `${node.slug}.md`);
        let text = "";
        try {
          text = await readFile(file, "utf8");
        } catch (err) {
          // A record whose file has not been materialised yet is indexed by
          // title alone rather than being left out of search entirely.
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        return {
          id: node.id,
          slug: node.slug!,
          title: node.name,
          text,
          links: wikiLinkTargets(text),
          access: this.tree.effectiveAccess(node.id),
          updatedAt: node.updatedAt,
        } satisfies IndexEntry;
      }),
    );
    this.entries = entries;
    this.builtAt = Date.now();
  }
}

/**
 * Plain text around the first match, for a search result line.
 *
 * Markup is stripped rather than rendered: a result line showing
 * `:::infobox{title=Досье}` tells the reader nothing about whether this is the
 * record they wanted.
 */
function snippet(text: string, needle: string, width = 120): string {
  const stripped = text
    .replace(/^#+\s*/gm, "")
    .replace(/^:{2,}[a-z-]*\{[^}]*\}\s*$/gim, "") // container fences and leaf widgets
    .replace(/^:{2,}\s*$/gm, "")
    .replace(/:[a-z-]+\[([^\]]*)\](?:\{[^}]*\})?/gi, "$1") // inline widgets keep their label
    .replace(/\[\[([^[\]|]+?)(?:\|[^[\]|]+?)?\]\]/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const at = stripped.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return stripped.slice(0, width);
  const from = Math.max(0, at - width / 3);
  return (from > 0 ? "…" : "") + stripped.slice(from, from + width).trim() + "…";
}

export async function registerWiki(app: FastifyInstance, options: WikiOptions): Promise<void> {
  const { tree, rooms, markdownDir } = options;
  const index = new RecordIndex(tree, markdownDir);

  const textOf = (doc: Y.Doc): string => doc.getText("content").toString();

  const publicNode = (node: TreeNode) => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    parentId: node.parentId,
    order: node.order,
    slug: node.slug,
    tags: node.tags ?? [],
    access: tree.effectiveAccess(node.id),
    updatedAt: node.updatedAt,
  });

  /**
   * The navigation tree.
   *
   * Restricted records are listed. A wiki whose secret pages are invisible
   * cannot show that there is something you are not cleared to read, and in a
   * setting built on secrets that absence is the wrong message - the old build
   * made the same call.
   */
  app.get("/api/wiki/nav", async () => ({
    nodes: tree.list().map(publicNode),
  }));

  app.get("/api/wiki/records/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const node = tree.bySlug(slug);
    if (!node) return reply.code(404).send({ error: "not found" });

    const access = tree.effectiveAccess(node.id);
    const clearance = clearanceOf(req);
    const breadcrumb = tree.pathOf(node.id).map((n) => ({ id: n.id, name: n.name }));

    const entries = await index.fresh();
    const backlinks = entries
      .filter((entry) => entry.slug !== slug && entry.links.includes(slug))
      .map((entry) => ({ slug: entry.slug, title: entry.title }));

    const base = {
      node: publicNode(node),
      breadcrumb,
      access,
      backlinks,
      restricted: access > clearance,
    };

    // Above the reader's clearance: the body never leaves the server.
    if (access > clearance) {
      return { ...base, html: "", infoboxes: [], headings: [], excerpt: "" };
    }

    const room = await rooms.get(recordRoom(node.id));
    const rendered = renderMarkup(textOf(room.doc), {
      linkExists: (target) => tree.hasSlug(target),
      extractInfoboxes: true,
    });
    return {
      ...base,
      html: rendered.html,
      infoboxes: rendered.infoboxes,
      headings: rendered.headings,
      excerpt: rendered.excerpt,
      links: rendered.links,
    };
  });

  app.get("/api/wiki/search", async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const needle = (q ?? "").trim();
    if (needle.length < 2) return { results: [] };

    const clearance = clearanceOf(req);
    const lower = needle.toLowerCase();
    const max = Math.min(Number(limit) || 20, 50);

    const results = (await index.fresh())
      .map((entry) => {
        const inTitle = entry.title.toLowerCase().includes(lower);
        const inSlug = entry.slug.includes(lower);
        // Restricted bodies are not searched: matching on text the reader
        // cannot read would leak it a word at a time.
        const readable = entry.access <= clearance;
        const inText = readable && entry.text.toLowerCase().includes(lower);
        if (!inTitle && !inSlug && !inText) return null;
        return {
          slug: entry.slug,
          title: entry.title,
          access: entry.access,
          restricted: !readable,
          score: (inTitle ? 2 : 0) + (inSlug ? 1 : 0) + (inText ? 1 : 0),
          snippet: inText ? snippet(entry.text, needle) : "",
        };
      })
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"))
      .slice(0, max);

    return { results };
  });

  /** Everything the front page needs: counts and the most recent edits. */
  app.get("/api/wiki/overview", async (req) => {
    const clearance = clearanceOf(req);
    const entries = await index.fresh();
    const nodes = tree.list();

    let bytes = 0;
    try {
      for (const name of await readdir(markdownDir)) {
        if (!name.endsWith(".md")) continue;
        bytes += (await stat(path.join(markdownDir, name))).size;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const recent = [...entries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        updatedAt: entry.updatedAt,
        restricted: entry.access > clearance,
      }));

    return {
      records: entries.length,
      folders: nodes.filter((node) => node.kind === "folder").length,
      restricted: entries.filter((entry) => entry.access > clearance).length,
      bytes,
      recent,
    };
  });
}
