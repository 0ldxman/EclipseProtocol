/**
 * Дерево-файловый менеджер.
 *
 * Папки — категории, вложенность не ограничена, запись лежит ровно в одной.
 * Перетаскивание — способ переложить запись, поэтому правила приёма проверяются
 * и здесь, и на сервере: папку нельзя бросить внутрь себя, в запись нельзя
 * положить ничего.
 *
 * Сервер остаётся источником истины — он перепроверяет и вправе отказать, — но
 * заведомо невозможный перенос не должен выглядеть принятым те доли секунды,
 * пока об этом узнают.
 *
 * Создание и переименование происходят строкой прямо в дереве. Это не украшение:
 * `prompt()` не показывает, куда именно ляжет новая запись, а в дереве строка
 * стоит на своём будущем месте, и промах виден до нажатия Enter.
 */

import type { NodeKind, TreeNode } from "./api";

export interface TreeCallbacks {
  onSelect: (node: TreeNode) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRename: (node: TreeNode, name: string) => void;
  onCreate: (kind: NodeKind, name: string, parentId: string | null) => void;
}

/** Что сейчас набирают в дереве: новую строку или новое имя существующей. */
type Draft =
  | { mode: "create"; kind: NodeKind; parentId: string | null }
  | { mode: "rename"; id: string };

export class TreeView {
  private nodes: TreeNode[] = [];
  private byId = new Map<string, TreeNode>();
  private childrenOf = new Map<string | null, TreeNode[]>();
  private expanded = new Set<string>();
  private collapsed = new Set<string>();
  private selectedId: string | null = null;
  private dragId: string | null = null;
  private draft: Draft | null = null;
  private filter = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: TreeCallbacks,
  ) {
    // Бросок на пустое место под деревом переносит в корень.
    this.host.addEventListener("dragover", (event) => {
      if (event.target === this.host && this.dragId) event.preventDefault();
    });
    this.host.addEventListener("drop", (event) => {
      if (event.target !== this.host || !this.dragId) return;
      event.preventDefault();
      this.callbacks.onMove(this.dragId, null);
      this.dragId = null;
    });
  }

  setNodes(nodes: TreeNode[]): void {
    this.nodes = nodes;
    this.byId = new Map(nodes.map((node) => [node.id, node]));
    this.childrenOf = new Map();
    for (const node of nodes) {
      const siblings = this.childrenOf.get(node.parentId) ?? [];
      siblings.push(node);
      this.childrenOf.set(node.parentId, siblings);
    }
    for (const list of this.childrenOf.values()) {
      list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.order - b.order || a.name.localeCompare(b.name, "ru");
      });
    }
    // Папки раскрыты по умолчанию: менеджер, прячущий содержимое на входе,
    // бесполезен ровно для того, зачем его открыли. Свёрнутые руками помнятся.
    for (const node of nodes) {
      if (node.kind === "folder" && !this.collapsed.has(node.id)) this.expanded.add(node.id);
    }
    this.render();
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.revealTo(id);
    this.render();
  }

  get selected(): TreeNode | null {
    return this.selectedId ? (this.byId.get(this.selectedId) ?? null) : null;
  }

  setFilter(value: string): void {
    this.filter = value.trim().toLocaleLowerCase("ru");
    this.render();
  }

  /** Начать ввод новой строки внутри папки (или в корне). */
  beginCreate(kind: NodeKind, parentId: string | null): void {
    if (parentId) {
      this.expanded.add(parentId);
      this.collapsed.delete(parentId);
      this.revealTo(parentId);
    }
    this.draft = { mode: "create", kind, parentId };
    this.render();
  }

  beginRename(id: string): void {
    this.draft = { mode: "rename", id };
    this.render();
  }

  cancelDraft(): void {
    this.draft = null;
    this.render();
  }

  /** Раскрыть всех предков, чтобы узел был виден. */
  private revealTo(id: string | null): void {
    let cursor = id ? this.byId.get(id) : undefined;
    const guard = new Set<string>();
    while (cursor?.parentId && !guard.has(cursor.parentId)) {
      guard.add(cursor.parentId);
      this.expanded.add(cursor.parentId);
      this.collapsed.delete(cursor.parentId);
      cursor = this.byId.get(cursor.parentId);
    }
  }

  /** True, когда `candidate` лежит внутри поддерева `id` (или это он сам). */
  private isDescendant(id: string, candidate: string): boolean {
    if (id === candidate) return true;
    let current = this.byId.get(candidate);
    const guard = new Set<string>();
    while (current?.parentId) {
      if (current.parentId === id) return true;
      if (guard.has(current.parentId)) return false;
      guard.add(current.parentId);
      current = this.byId.get(current.parentId);
    }
    return false;
  }

  private canDrop(dragId: string, targetId: string | null): boolean {
    if (targetId === null) return true;
    const target = this.byId.get(targetId);
    if (!target || target.kind !== "folder") return false;
    return !this.isDescendant(dragId, targetId);
  }

  /** Узел проходит фильтр сам или содержит подходящего потомка. */
  private matches(node: TreeNode): boolean {
    if (!this.filter) return true;
    const own =
      node.name.toLocaleLowerCase("ru").includes(this.filter) ||
      (node.slug ?? "").includes(this.filter);
    if (own) return true;
    return (this.childrenOf.get(node.id) ?? []).some((child) => this.matches(child));
  }

  private render(): void {
    this.host.replaceChildren();
    for (const node of this.childrenOf.get(null) ?? []) {
      if (this.matches(node)) this.host.append(...this.renderNode(node, 0));
    }
    if (this.draft?.mode === "create" && this.draft.parentId === null) {
      this.host.append(this.draftRow(0));
    }
    if (this.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "Пусто. Создайте папку или запись.";
      this.host.append(empty);
    } else if (this.filter && this.host.childElementCount === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = `Ничего не найдено по «${this.filter}».`;
      this.host.append(empty);
    }
    // Поле ввода появляется уже в дереве — фокус ставится после вставки.
    this.host.querySelector<HTMLInputElement>(".tree-input")?.focus();
    this.host.querySelector<HTMLInputElement>(".tree-input")?.select();
  }

  /** Строка ввода: одна и та же для создания и переименования. */
  private draftRow(depth: number, node?: TreeNode): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "tree-row is-draft";
    row.style.paddingLeft = `${6 + depth * 14}px`;

    const kind = node ? node.kind : (this.draft as { kind: NodeKind }).kind;
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.innerHTML = glyph(kind);

    const input = document.createElement("input");
    input.className = "tree-input";
    input.value = node?.name ?? "";
    input.placeholder = kind === "folder" ? "название папки" : "название записи";
    input.spellcheck = false;

    const commit = () => {
      const value = input.value.trim();
      const draft = this.draft;
      this.draft = null;
      if (!value) return this.render();
      if (draft?.mode === "rename" && node) this.callbacks.onRename(node, value);
      else if (draft?.mode === "create") this.callbacks.onCreate(draft.kind, value, draft.parentId);
    };

    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.cancelDraft();
      }
    };
    // Уход фокуса — тоже подтверждение: набранное имя не должно пропадать
    // оттого, что человек кликнул мимо.
    input.onblur = () => {
      if (this.draft) commit();
    };

    row.append(document.createElement("span"), icon, input);
    row.firstElementChild!.className = "twisty";
    return row;
  }

  private renderNode(node: TreeNode, depth: number): HTMLDivElement[] {
    if (this.draft?.mode === "rename" && this.draft.id === node.id) {
      return [this.draftRow(depth, node)];
    }

    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.id = node.id;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    row.draggable = true;
    if (node.id === this.selectedId) row.classList.add("is-selected");
    if (node.name === "_cover") row.classList.add("is-cover");

    const isFolder = node.kind === "folder";
    const open = this.expanded.has(node.id) || Boolean(this.filter);

    const twisty = document.createElement("button");
    twisty.className = "twisty";
    twisty.type = "button";
    twisty.textContent = isFolder ? (open ? "▾" : "▸") : "";
    twisty.onclick = (event) => {
      event.stopPropagation();
      if (!isFolder) return;
      if (this.expanded.has(node.id)) {
        this.expanded.delete(node.id);
        this.collapsed.add(node.id);
      } else {
        this.expanded.add(node.id);
        this.collapsed.delete(node.id);
      }
      this.render();
    };

    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.innerHTML = glyph(node.kind);

    const label = document.createElement("span");
    label.className = "tree-name";
    label.textContent = node.name === "_cover" ? "титульный лист" : node.name;

    row.append(twisty, icon, label);

    if (node.kind === "record" && node.slug && node.name !== "_cover") {
      const slug = document.createElement("span");
      slug.className = "tree-slug";
      slug.textContent = node.slug;
      row.append(slug);
    }
    if ((node.effectiveAccess ?? 0) > 0) {
      const lock = document.createElement("span");
      lock.className = "tree-access";
      lock.textContent = `⌾${node.effectiveAccess}`;
      lock.title = `требуется допуск ${node.effectiveAccess}`;
      row.append(lock);
    }

    row.onclick = () => {
      this.selectedId = node.id;
      this.render();
      this.callbacks.onSelect(node);
    };
    row.ondblclick = () => this.beginRename(node.id);

    row.ondragstart = (event) => {
      this.dragId = node.id;
      event.dataTransfer?.setData("text/plain", node.id);
    };
    row.ondragend = () => {
      this.dragId = null;
      for (const el of this.host.querySelectorAll(".is-drop")) el.classList.remove("is-drop");
    };
    row.ondragover = (event) => {
      if (!this.dragId || !this.canDrop(this.dragId, node.id)) return;
      event.preventDefault();
      row.classList.add("is-drop");
    };
    row.ondragleave = () => row.classList.remove("is-drop");
    row.ondrop = (event) => {
      row.classList.remove("is-drop");
      if (!this.dragId || !this.canDrop(this.dragId, node.id)) return;
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onMove(this.dragId, node.id);
      this.dragId = null;
    };

    const out: HTMLDivElement[] = [row];
    if (isFolder && open) {
      for (const child of this.childrenOf.get(node.id) ?? []) {
        if (this.matches(child)) out.push(...this.renderNode(child, depth + 1));
      }
      if (this.draft?.mode === "create" && this.draft.parentId === node.id) {
        out.push(this.draftRow(depth + 1));
      }
    }
    return out;
  }
}

/** Свои значки: в JetBrains Mono нет ни папки, ни документа — были бы квадраты. */
function glyph(kind: NodeKind): string {
  return kind === "folder"
    ? '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
        '<path d="M1 2.5h3.2l1 1.4H11v6H1z" fill="none" stroke="currentColor" ' +
        'stroke-width="1" stroke-linejoin="round"/></svg>'
    : '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
        '<path d="M2.5 1h4.2L9.5 3.8V11h-7z" fill="none" stroke="currentColor" ' +
        'stroke-width="1" stroke-linejoin="round"/>' +
        '<path d="M4.2 6h3.6M4.2 8h3.6" stroke="currentColor" stroke-width="1"/></svg>';
}
