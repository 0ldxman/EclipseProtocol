/**
 * The file-manager tree.
 *
 * Folders are categories, nesting is unlimited, and a record sits in exactly
 * one of them. Dragging is how records get reorganised, so the drop rules are
 * enforced here as well as on the server: a folder cannot be dropped into its
 * own descendant, and nothing can be dropped into a record.
 *
 * The server is still the authority - it re-checks and can reject - but a drop
 * that would obviously fail should not look accepted for the moment it takes to
 * find out.
 */

import type { TreeNode } from "./api";

export interface TreeCallbacks {
  onSelect: (node: TreeNode) => void;
  onMove: (id: string, parentId: string | null) => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}

export class TreeView {
  private nodes: TreeNode[] = [];
  private byId = new Map<string, TreeNode>();
  private childrenOf = new Map<string | null, TreeNode[]>();
  private expanded = new Set<string>();
  private selectedId: string | null = null;
  private dragId: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: TreeCallbacks,
  ) {
    // A drop on empty space below the tree moves the item to the root.
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
    // Folders start open: a file manager that hides everything on load is
    // useless for finding out what is in it.
    for (const node of nodes) {
      if (node.kind === "folder" && !this.expanded.has(node.id)) this.expanded.add(node.id);
    }
    this.render();
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.render();
  }

  get selected(): TreeNode | null {
    return this.selectedId ? (this.byId.get(this.selectedId) ?? null) : null;
  }

  /** True when `candidate` is inside `id`'s subtree (or is it). */
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

  private render(): void {
    this.host.replaceChildren();
    const roots = this.childrenOf.get(null) ?? [];
    for (const node of roots) this.host.append(...this.renderNode(node, 0));
    if (this.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "Пусто. Создайте папку или запись.";
      this.host.append(empty);
    }
  }

  private renderNode(node: TreeNode, depth: number): HTMLDivElement[] {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.id = node.id;
    row.style.paddingLeft = `${6 + depth * 14}px`;
    row.draggable = true;
    if (node.id === this.selectedId) row.classList.add("is-selected");

    const isFolder = node.kind === "folder";
    const open = this.expanded.has(node.id);

    const twisty = document.createElement("button");
    twisty.className = "twisty";
    twisty.textContent = isFolder ? (open ? "▾" : "▸") : "";
    twisty.onclick = (event) => {
      event.stopPropagation();
      if (!isFolder) return;
      if (open) this.expanded.delete(node.id);
      else this.expanded.add(node.id);
      this.render();
    };

    // Inline SVG rather than a glyph: JetBrains Mono has no folder or
    // document character, so those render as tofu boxes.
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.innerHTML = isFolder
      ? '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
        '<path d="M1 2.5h3.2l1 1.4H11v6H1z" fill="none" stroke="currentColor" ' +
        'stroke-width="1" stroke-linejoin="round"/></svg>'
      : '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
        '<path d="M2.5 1h4.2L9.5 3.8V11h-7z" fill="none" stroke="currentColor" ' +
        'stroke-width="1" stroke-linejoin="round"/>' +
        '<path d="M4.2 6h3.6M4.2 8h3.6" stroke="currentColor" stroke-width="1"/></svg>';

    const label = document.createElement("span");
    label.className = "tree-name";
    label.textContent = node.name;

    row.append(twisty, icon, label);

    if (node.kind === "record" && node.slug) {
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
    row.ondblclick = () => this.callbacks.onRename(node);
    row.oncontextmenu = (event) => {
      event.preventDefault();
      this.callbacks.onDelete(node);
    };

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
        out.push(...this.renderNode(child, depth + 1));
      }
    }
    return out;
  }
}
