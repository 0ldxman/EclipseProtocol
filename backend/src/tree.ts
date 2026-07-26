/**
 * The folder tree behind the file-manager admin.
 *
 * Deliberately *not* a CRDT, unlike everything else that is edited live. Moving
 * nodes concurrently in a replicated tree can produce a cycle - A inside B while
 * B is inside A - and the result is a subtree that has silently detached itself
 * from the root. Folders get reorganised rarely, so a server-side operation with
 * a cycle check is far cheaper than making that class of bug impossible by
 * construction.
 *
 * Four axes are kept separate here, because conflating them is what made the
 * previous attempt paint itself into a corner:
 *
 *   identity   - a flat, unique `slug`; what `[[links]]` address
 *   location   - exactly one parent folder; breadcrumbs and access inheritance
 *   labelling  - `tags`, many-to-many, for browsing
 *   access     - rules on folders, inherited downwards
 *
 * Because a link addresses the slug and never the path, a record can be dragged
 * anywhere in the tree without breaking a single reference to it.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type NodeKind = "folder" | "record";

export interface TreeNode {
  id: string;
  kind: NodeKind;
  name: string;
  parentId: string | null;
  /** Position among siblings; gaps are fine, order is by value then name. */
  order: number;
  /** Records only: the flat identity used by links and URLs. */
  slug?: string;
  tags?: string[];
  /**
   * Записи только: место в летописи.
   *
   * Дата события — свойство записи, а не строчка в её теле. Раньше она жила
   * директивой внутри текста, и любая правка абзаца могла незаметно вынести
   * запись из хронологии. Эпоха может быть пустой: события до первой
   * названной эпохи в летописи есть, а эпохи у них нет.
   */
  eventAt?: string;
  eventEpoch?: string;
  /** Folders only: minimum access level required, inherited downwards. */
  accessLevel?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TreeSnapshot {
  nodes: TreeNode[];
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Readable ASCII slug; Cyrillic is transliterated rather than dropped. */
export function slugify(value: string): string {
  const lower = value.toLowerCase().trim();
  let out = "";
  for (const char of lower) {
    out += CYRILLIC[char] ?? char;
  }
  return (
    out
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "zapis"
  );
}

export class TreeStore {
  private nodes = new Map<string, TreeNode>();
  private loaded = false;

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as TreeSnapshot;
      for (const node of parsed.nodes) this.nodes.set(node.id, node);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    // Write-then-rename: a crash midway through leaves the previous tree
    // intact rather than a truncated file that loses every record's location.
    const temporary = `${this.file}.tmp`;
    const snapshot: TreeSnapshot = { nodes: [...this.nodes.values()] };
    await writeFile(temporary, JSON.stringify(snapshot, null, 1), "utf8");
    await rename(temporary, this.file);
  }

  list(): TreeNode[] {
    return [...this.nodes.values()].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"),
    );
  }

  get(id: string): TreeNode | undefined {
    return this.nodes.get(id);
  }

  bySlug(slug: string): TreeNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.kind === "record" && node.slug === slug) return node;
    }
    return undefined;
  }

  hasSlug(slug: string): boolean {
    return this.bySlug(slug) !== undefined;
  }

  /** Ancestors from the root down to (but not including) the node itself. */
  pathOf(id: string): TreeNode[] {
    const chain: TreeNode[] = [];
    let current = this.nodes.get(id);
    const guard = new Set<string>();
    while (current?.parentId) {
      if (guard.has(current.parentId)) break; // defensive; moves cannot create this
      guard.add(current.parentId);
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  }

  /**
   * Effective access level: the strictest rule on the path.
   *
   * A child can never be more public than the folder containing it - "put it in
   * the secret folder" has to mean what it says, otherwise a stray setting deep
   * in the tree quietly opens a hole.
   */
  effectiveAccess(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;
    let level = node.accessLevel ?? 0;
    for (const ancestor of this.pathOf(id)) {
      level = Math.max(level, ancestor.accessLevel ?? 0);
    }
    return level;
  }

  private nextOrder(parentId: string | null): number {
    let max = 0;
    for (const node of this.nodes.values()) {
      if (node.parentId === parentId) max = Math.max(max, node.order);
    }
    return max + 10;
  }

  private uniqueSlug(base: string): string {
    let candidate = base;
    let n = 2;
    while (this.hasSlug(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  }

  async create(input: {
    kind: NodeKind;
    name: string;
    parentId: string | null;
    slug?: string;
  }): Promise<TreeNode> {
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = this.nodes.get(parentId);
      if (!parent) throw new TreeError("parent not found", 404);
      if (parent.kind !== "folder") throw new TreeError("parent must be a folder", 400);
    }
    const now = new Date().toISOString();
    const node: TreeNode = {
      id: randomUUID(),
      kind: input.kind,
      name: input.name.trim() || (input.kind === "folder" ? "Новая папка" : "Без названия"),
      parentId,
      order: this.nextOrder(parentId),
      createdAt: now,
      updatedAt: now,
    };
    if (input.kind === "record") {
      node.slug = this.uniqueSlug(slugify(input.slug ?? node.name));
      node.tags = [];
    }
    this.nodes.set(node.id, node);
    await this.persist();
    return node;
  }

  async rename(id: string, name: string): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node) throw new TreeError("not found", 404);
    node.name = name.trim() || node.name;
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  /** Changing a slug is a rename of the record's identity; links must follow. */
  async setSlug(id: string, slug: string): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node || node.kind !== "record") throw new TreeError("record not found", 404);
    const wanted = slugify(slug);
    const existing = this.bySlug(wanted);
    if (existing && existing.id !== id) throw new TreeError("slug already taken", 409);
    node.slug = wanted;
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  /**
   * Метки записи. Живут поперёк дерева, поэтому здесь только нормализация:
   * пустые отбрасываются, регистр приводится к нижнему, повторы схлопываются —
   * иначе «Разлом» и «разлом» станут двумя разными страницами меток.
   */
  async setTags(id: string, tags: string[]): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node || node.kind !== "record") throw new TreeError("record not found", 404);
    const seen = new Set<string>();
    node.tags = tags
      .map((tag) => tag.trim().toLocaleLowerCase("ru"))
      .filter((tag) => tag.length > 0 && tag.length <= 48)
      .filter((tag) => (seen.has(tag) ? false : (seen.add(tag), true)))
      .slice(0, 24);
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  /**
   * Место записи в летописи. Пустая дата снимает запись с хронологии.
   */
  async setEvent(id: string, at: string, epoch: string): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node || node.kind !== "record") throw new TreeError("record not found", 404);
    const day = at.trim();
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new TreeError("event date must be YYYY-MM-DD", 400);
    }
    if (day) {
      node.eventAt = day;
      node.eventEpoch = epoch.trim();
    } else {
      delete node.eventAt;
      delete node.eventEpoch;
    }
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  async setAccess(id: string, level: number): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node) throw new TreeError("not found", 404);
    node.accessLevel = Math.max(0, Math.round(level));
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  /** True when `maybeAncestor` is the node itself or sits above it. */
  private isAncestor(maybeAncestor: string, id: string): boolean {
    if (maybeAncestor === id) return true;
    let current = this.nodes.get(id);
    const guard = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === maybeAncestor) return true;
      if (guard.has(current.parentId)) return false;
      guard.add(current.parentId);
      current = this.nodes.get(current.parentId);
    }
    return false;
  }

  async move(id: string, parentId: string | null, order?: number): Promise<TreeNode> {
    const node = this.nodes.get(id);
    if (!node) throw new TreeError("not found", 404);

    if (parentId !== null) {
      const parent = this.nodes.get(parentId);
      if (!parent) throw new TreeError("target folder not found", 404);
      if (parent.kind !== "folder") throw new TreeError("target must be a folder", 400);
      // The check that makes this store worth having: dropping a folder into
      // its own descendant would detach that whole subtree from the root.
      if (this.isAncestor(id, parentId)) {
        throw new TreeError("cannot move a folder into itself", 400);
      }
    }

    node.parentId = parentId;
    node.order = order ?? this.nextOrder(parentId);
    node.updatedAt = new Date().toISOString();
    await this.persist();
    return node;
  }

  /** Ids of a node and everything beneath it, deepest last. */
  descendants(id: string): string[] {
    const out: string[] = [];
    const walk = (parent: string) => {
      for (const node of this.nodes.values()) {
        if (node.parentId !== parent) continue;
        out.push(node.id);
        walk(node.id);
      }
    };
    walk(id);
    return out;
  }

  async remove(id: string): Promise<string[]> {
    const node = this.nodes.get(id);
    if (!node) throw new TreeError("not found", 404);
    const removed = [id, ...this.descendants(id)];
    for (const nodeId of removed) this.nodes.delete(nodeId);
    await this.persist();
    return removed;
  }
}

export class TreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
