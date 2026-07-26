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
import {
  coverAttributes,
  firstImageOf,
  renderMarkup,
  wikiLinkTargets,
  type RecordEvent,
} from "@aether/markup";
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
  parentId: string | null;
  /** Первая картинка тела: карточке в летописи больше нечем себя показать. */
  image: string | null;
  /** Заполнено, если запись объявила себя событием летописи. */
  event: RecordEvent | null;
}

/**
 * Обложка категории — обычная запись с этим именем внутри папки.
 *
 * Не отдельная сущность в дереве: её правят тем же редактором, что и всё
 * остальное, и она не требует ни своей формы в админке, ни своего хранилища.
 */
const COVER_NAME = "_cover";

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
          parentId: node.parentId,
          image: firstImageOf(text),
          // Событие берётся из свойств записи, а не из её текста: правка
          // абзаца не должна снимать запись с летописи.
          event: node.eventAt ? { at: node.eventAt, epoch: node.eventEpoch ?? "" } : null,
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

  /** Обложка — служебная запись; в списках и поиске её быть не должно. */
  const isCover = (node: TreeNode): boolean => node.kind === "record" && node.name === COVER_NAME;

  /**
   * Ближайшая обложка вверх по дереву.
   *
   * Своя обложка вложенной папки перекрывает родительскую целиком. Если своей
   * нет, запись поднимается на уровень выше — и так до корня, где обложки
   * может не оказаться вовсе.
   */
  function coverFor(startId: string | null): { folder: TreeNode; cover: TreeNode } | null {
    const all = tree.list();
    let id = startId;
    while (id) {
      const folder = all.find((node) => node.id === id);
      if (!folder) return null;
      const cover = all.find((node) => node.parentId === id && isCover(node));
      if (cover) return { folder, cover };
      id = folder.parentId;
    }
    return null;
  }

  /** Название и схема ближайшей обложки — для полосы принадлежности. */
  async function belongsOf(startId: string | null) {
    const found = coverFor(startId);
    if (!found) return null;
    const source = await coverSource(found.cover);
    const attrs = coverAttributes(source) ?? {};
    return {
      id: found.folder.id,
      name: found.folder.name,
      theme: attrs.theme ?? "",
      logo: attrs.logo ?? "",
      mark: attrs.mark ?? "◆",
    };
  }

  const coverSource = async (node: TreeNode): Promise<string> => {
    const entry = (await index.fresh()).find((e) => e.id === node.id);
    if (entry?.text) return entry.text;
    const room = await rooms.get(recordRoom(node.id));
    return textOf(room.doc);
  };

  /** Сведения о записи для `::record{slug=…}`: подставляет сервер, не автор. */
  const resolveRecord = (slug: string) => {
    const node = tree.bySlug(slug);
    if (!node) return null;
    const parent = node.parentId ? tree.list().find((n) => n.id === node.parentId) : undefined;
    return {
      title: node.name,
      category: parent?.name,
      access: tree.effectiveAccess(node.id),
    };
  };

  /**
   * The navigation tree.
   *
   * Restricted records are listed. A wiki whose secret pages are invisible
   * cannot show that there is something you are not cleared to read, and in a
   * setting built on secrets that absence is the wrong message - the old build
   * made the same call.
   */
  app.get("/api/wiki/nav", async () => ({
    nodes: tree.list().filter((node) => !isCover(node)).map(publicNode),
  }));

  /**
   * Категория: её обложка и путь к ней.
   *
   * Список записей клиент собирает из дерева, которое у него уже есть;
   * отдельно отдаётся только то, чего в дереве нет.
   */
  app.get("/api/wiki/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = tree.list().find((n) => n.id === id && n.kind === "folder");
    if (!node) return reply.code(404).send({ error: "not found" });

    const access = tree.effectiveAccess(node.id);
    const clearance = clearanceOf(req);
    const breadcrumb = tree.pathOf(node.id).map((n) => ({ id: n.id, name: n.name }));

    // Обложка своя, а не унаследованная: у категории без своей обложки
    // титульного листа нет — есть обычное оглавление.
    const own = tree.list().find((n) => n.parentId === node.id && isCover(n));
    let cover = "";
    if (own && access <= clearance) {
      const rendered = renderMarkup(await coverSource(own), {
        linkExists: (target) => tree.hasSlug(target),
        resolveRecord,
      });
      cover = rendered.html;
    }

    return {
      node: publicNode(node),
      breadcrumb,
      access,
      restricted: access > clearance,
      cover,
    };
  });

  /**
   * Летопись.
   *
   * Собирается из самих записей: запись объявляет себя событием директивой
   * `::event{at=… epoch=…}`. Отдельного хранилища у ленты нет, поэтому она
   * не может разойтись с записями, из которых состоит.
   */
  app.get("/api/wiki/timeline", async (req) => {
    const clearance = clearanceOf(req);
    const entries = (await index.fresh()).filter((entry) => entry.event);

    const events = entries
      .map((entry) => {
        const restricted = entry.access > clearance;
        return {
          slug: entry.slug,
          title: entry.title,
          at: entry.event!.at,
          // Пустая эпоха так и остаётся пустой: у событий, что идут до первой
          // названной эпохи, эпохи нет, и придумывать её летописи незачем.
          epoch: entry.event!.epoch,
          access: entry.access,
          restricted,
          // Тело закрытой записи не покидает сервер и здесь тоже — ни текстом,
          // ни картинкой.
          summary: restricted ? "" : snippet(entry.text, "", 150),
          image: restricted ? "" : (entry.image ?? ""),
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at));

    // Эпохи в порядке первого события: летопись читается сверху вниз.
    // Безымянная эпоха не заводится: события до первой названной просто идут
    // от начала ленты.
    const epochs: { name: string; from: string; to: string; count: number }[] = [];
    for (const event of events) {
      if (!event.epoch) continue;
      const last = epochs.at(-1);
      if (last && last.name === event.epoch) {
        last.to = event.at;
        last.count += 1;
      } else {
        epochs.push({ name: event.epoch, from: event.at, to: event.at, count: 1 });
      }
    }

    return { epochs, events };
  });

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

    // Neighbours inside the same folder, so a reader can move sideways without
    // going back to the index - which is how wikis are actually read.
    const family = tree
      .list()
      .filter((n) => n.parentId === node.parentId && n.kind === "record" && n.slug && !isCover(n))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    const here = family.findIndex((n) => n.id === node.id);
    const sideways = (n: TreeNode | undefined) =>
      n ? { slug: n.slug!, title: n.name } : null;

    const base = {
      node: publicNode(node),
      breadcrumb,
      access,
      backlinks,
      siblings: { prev: sideways(family[here - 1]), next: sideways(family[here + 1]) },
      belongs: await belongsOf(node.parentId),
      restricted: access > clearance,
    };

    // Above the reader's clearance: the body never leaves the server.
    //
    // What does go out is its *size*. Telling the reader that 1 842 characters
    // in three sections are withheld says nothing about what they say, and it
    // is the difference between a page that is closed and a page that looks
    // broken. The count comes from the materialised file, not the live room.
    if (access > clearance) {
      const entry = entries.find((e) => e.slug === slug);
      const body = entry?.text ?? "";
      return {
        ...base,
        html: "",
        infoboxes: [],
        headings: [],
        excerpt: "",
        hidden: {
          chars: body.replace(/\s+/g, " ").trim().length,
          sections: (body.match(/^##\s+/gm) ?? []).length,
          attachments: (body.match(/^::(image|video|file)\{/gm) ?? []).length,
        },
      };
    }

    const room = await rooms.get(recordRoom(node.id));
    const rendered = renderMarkup(textOf(room.doc), {
      linkExists: (target) => tree.hasSlug(target),
      extractInfoboxes: true,
      resolveRecord,
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
      .filter((entry) => entry.title !== COVER_NAME)
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
    // Обложки не записи: они не попадают ни в счётчики, ни в ленту изменений.
    const entries = (await index.fresh()).filter((entry) => entry.title !== COVER_NAME);
    const nodes = tree.list().filter((node) => !isCover(node));

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
