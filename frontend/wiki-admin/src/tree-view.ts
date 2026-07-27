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
 *
 * Три вещи, которых здесь не было и без которых менеджер оставался смотровой
 * площадкой:
 *
 *   — создание изнутри строки. Кнопки «+ папка» наверху кладут в выбранное, но
 *     что именно выбрано, приходилось помнить. Плюс на самой папке и правая
 *     кнопка на ней отвечают на вопрос «куда» самим местом нажатия;
 *   — порядок. Бросок ловился только папкой, и разложить записи внутри
 *     категории было нечем, хотя `order` в дереве есть с самого начала. Теперь
 *     верх и низ строки — это «перед» и «после», а середина папки — «внутрь»;
 *   — клавиатура. Стрелки водят по дереву, и до нужной записи не нужно
 *     возвращаться к мыши.
 */

import type { NodeKind, TreeNode } from "./api";

/** Куда ляжет то, что сейчас тащат или создают. */
export type DropSpot = { parentId: string | null; before: string | null };

export interface TreeCallbacks {
  onSelect: (node: TreeNode) => void;
  /** `order` приходит, когда бросок пришёлся между строк. */
  onMove: (id: string, parentId: string | null, order?: number) => void;
  onRename: (node: TreeNode, name: string) => void;
  onCreate: (kind: NodeKind, name: string, parentId: string | null, order?: number) => void;
  onDelete: (node: TreeNode) => void;
  /** Открыть или завести титульный лист категории. */
  onCover: (folder: TreeNode) => void;
}

/** Что сейчас набирают в дереве: новую строку или новое имя существующей. */
type Draft =
  | { mode: "create"; kind: NodeKind; parentId: string | null; order?: number }
  | { mode: "rename"; id: string };

/** Куда целится текущий бросок. */
type Aim =
  | { at: "into"; id: string }
  | { at: "before" | "after"; id: string };

const COVER = "_cover";

export class TreeView {
  private nodes: TreeNode[] = [];
  private byId = new Map<string, TreeNode>();
  private childrenOf = new Map<string | null, TreeNode[]>();
  private expanded = new Set<string>();
  private collapsed = new Set<string>();
  private selectedId: string | null = null;
  private dragId: string | null = null;
  private aim: Aim | null = null;
  private draft: Draft | null = null;
  private filter = "";
  /** Видимые строки в порядке экрана — по ним ходят стрелки. */
  private flat: TreeNode[] = [];
  private menu: HTMLElement | null = null;

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
    // Правая кнопка на пустом месте — создание в корне.
    this.host.addEventListener("contextmenu", (event) => {
      if (event.target !== this.host) return;
      event.preventDefault();
      this.openMenu(event, null);
    });
    this.host.addEventListener("keydown", (event) => this.onKey(event));
    this.host.tabIndex = 0;
    addEventListener("pointerdown", (event) => {
      if (this.menu && !this.menu.contains(event.target as Node)) this.closeMenu();
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
    for (const list of this.childrenOf.values()) list.sort(byOrder);
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
  beginCreate(kind: NodeKind, parentId: string | null, order?: number): void {
    if (parentId) {
      this.expanded.add(parentId);
      this.collapsed.delete(parentId);
      this.revealTo(parentId);
    }
    this.draft = { mode: "create", kind, parentId, order };
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

  /**
   * Значение `order`, ставящее узел между соседями.
   *
   * Числа с запятой здесь уместны: вставка между 10 и 20 не должна
   * перенумеровывать папку целиком, а перенумерация — это N запросов вместо
   * одного и N шансов разъехаться с сервером.
   */
  private orderBefore(node: TreeNode): number {
    const siblings = (this.childrenOf.get(node.parentId) ?? []).filter((n) => n.id !== this.dragId);
    const at = siblings.findIndex((n) => n.id === node.id);
    const previous = at > 0 ? siblings[at - 1]!.order : node.order - 20;
    return (previous + node.order) / 2;
  }

  private orderAfter(node: TreeNode): number {
    const siblings = (this.childrenOf.get(node.parentId) ?? []).filter((n) => n.id !== this.dragId);
    const at = siblings.findIndex((n) => n.id === node.id);
    const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1]!.order : node.order + 20;
    return (node.order + next) / 2;
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
    this.closeMenu();
    this.flat = [];
    this.host.replaceChildren();
    for (const node of this.childrenOf.get(null) ?? []) {
      if (this.matches(node)) this.host.append(...this.renderNode(node, 0));
    }
    if (this.draft?.mode === "create" && this.draft.parentId === null) {
      this.host.append(this.draftRow(0));
    }
    if (this.nodes.length === 0) {
      this.host.append(
        make("div", "tree-empty", "Пусто. Создайте папку или запись — или нажмите правую кнопку."),
      );
    } else if (this.filter && this.host.childElementCount === 0) {
      this.host.append(make("div", "tree-empty", `Ничего не найдено по «${this.filter}».`));
    }
    // Поле ввода появляется уже в дереве — фокус ставится после вставки.
    this.host.querySelector<HTMLInputElement>(".tree-input")?.focus();
    this.host.querySelector<HTMLInputElement>(".tree-input")?.select();
  }

  /** Строка ввода: одна и та же для создания и переименования. */
  private draftRow(depth: number, node?: TreeNode): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "tree-row is-draft";
    row.style.setProperty("--depth", String(depth));

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
      else if (draft?.mode === "create") {
        this.callbacks.onCreate(draft.kind, value, draft.parentId, draft.order);
      }
    };

    input.onkeydown = (event) => {
      event.stopPropagation();
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

    const twisty = document.createElement("span");
    twisty.className = "twisty";
    row.append(twisty, icon, input);
    return row;
  }

  private renderNode(node: TreeNode, depth: number): HTMLDivElement[] {
    if (this.draft?.mode === "rename" && this.draft.id === node.id) {
      return [this.draftRow(depth, node)];
    }
    this.flat.push(node);

    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.id = node.id;
    row.style.setProperty("--depth", String(depth));
    row.draggable = true;
    if (node.id === this.selectedId) row.classList.add("is-selected");
    if (node.name === COVER) row.classList.add("is-cover");
    if (this.aim?.id === node.id) row.classList.add(`is-${this.aim.at}`);

    const isFolder = node.kind === "folder";
    const open = this.expanded.has(node.id) || Boolean(this.filter);

    const twisty = document.createElement("button");
    twisty.className = "twisty";
    twisty.type = "button";
    twisty.tabIndex = -1;
    twisty.textContent = isFolder ? (open ? "▾" : "▸") : "";
    if (isFolder) twisty.setAttribute("aria-label", open ? "Свернуть" : "Развернуть");
    twisty.onclick = (event) => {
      event.stopPropagation();
      if (isFolder) this.toggle(node.id);
    };

    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.innerHTML = glyph(node.kind);

    const label = document.createElement("span");
    label.className = "tree-name";
    label.textContent = node.name === COVER ? "титульный лист" : node.name;

    row.append(twisty, icon, label);

    if (node.kind === "record" && node.slug && node.name !== COVER) {
      row.append(make("span", "tree-slug", node.slug));
    }
    if ((node.effectiveAccess ?? 0) > 0) {
      const lock = make("span", "tree-access", `⌾${node.effectiveAccess}`);
      lock.title = `требуется допуск ${node.effectiveAccess}`;
      row.append(lock);
    }
    // Сколько внутри — видно, когда папка свёрнута: иначе пустая и полная
    // категории выглядят одинаково.
    if (isFolder && !open) {
      const inside = (this.childrenOf.get(node.id) ?? []).length;
      if (inside > 0) row.append(make("span", "tree-count", String(inside)));
    }

    // Быстрое создание там, где на него смотрят. Появляется по наведению,
    // чтобы дерево в покое оставалось списком имён, а не панелью кнопок.
    if (isFolder) {
      const add = document.createElement("button");
      add.className = "tree-add";
      add.type = "button";
      add.tabIndex = -1;
      add.title = "Новая запись внутри";
      add.setAttribute("aria-label", `Новая запись в «${node.name}»`);
      add.textContent = "+";
      add.onclick = (event) => {
        event.stopPropagation();
        this.beginCreate("record", node.id);
      };
      row.append(add);
    }

    row.onclick = () => {
      this.selectedId = node.id;
      this.render();
      this.host.focus({ preventScroll: true });
      this.callbacks.onSelect(node);
    };
    row.ondblclick = () => this.beginRename(node.id);
    row.oncontextmenu = (event) => {
      event.preventDefault();
      this.selectedId = node.id;
      this.render();
      this.callbacks.onSelect(node);
      this.openMenu(event, node);
    };

    row.ondragstart = (event) => {
      this.dragId = node.id;
      event.dataTransfer?.setData("text/plain", node.id);
      row.classList.add("is-dragging");
    };
    row.ondragend = () => {
      this.dragId = null;
      this.aim = null;
      this.render();
    };
    row.ondragover = (event) => {
      const next = this.aimAt(node, event, row);
      if (!next) return;
      event.preventDefault();
      if (this.aim?.id !== next.id || this.aim.at !== next.at) {
        this.aim = next;
        this.paintAim();
      }
    };
    row.ondragleave = (event) => {
      if (row.contains(event.relatedTarget as Node)) return;
      if (this.aim?.id === node.id) {
        this.aim = null;
        this.paintAim();
      }
    };
    row.ondrop = (event) => {
      const spot = this.aimAt(node, event, row);
      this.aim = null;
      const dragged = this.dragId;
      this.dragId = null;
      this.paintAim();
      if (!spot || !dragged) return;
      event.preventDefault();
      event.stopPropagation();
      if (spot.at === "into") this.callbacks.onMove(dragged, node.id);
      else if (spot.at === "before") this.callbacks.onMove(dragged, node.parentId, this.orderBefore(node));
      else this.callbacks.onMove(dragged, node.parentId, this.orderAfter(node));
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

  /**
   * Куда целится указатель на этой строке.
   *
   * Верхняя и нижняя четверть — «перед» и «после», середина папки — «внутрь».
   * У записи середины нет: внутрь записи ничего не кладётся, и делить её на
   * три значило бы отдавать половину высоты недопустимому действию.
   */
  private aimAt(node: TreeNode, event: DragEvent, row: HTMLElement): Aim | null {
    if (!this.dragId || this.dragId === node.id) return null;
    if (this.isDescendant(this.dragId, node.id) && node.kind === "folder") return null;
    if (this.filter) return this.canDrop(this.dragId, node.id) ? { at: "into", id: node.id } : null;

    const box = row.getBoundingClientRect();
    const part = (event.clientY - box.top) / box.height;
    if (node.kind === "folder" && part > 0.28 && part < 0.72) {
      return this.canDrop(this.dragId, node.id) ? { at: "into", id: node.id } : null;
    }
    return { at: part < 0.5 ? "before" : "after", id: node.id };
  }

  /** Подсветка цели — без перерисовки дерева: перерисовка на каждый пиксель
      сбрасывает перетаскивание в некоторых браузерах и всегда мигает. */
  private paintAim(): void {
    for (const row of this.host.querySelectorAll<HTMLElement>(".tree-row")) {
      row.classList.remove("is-into", "is-before", "is-after");
      if (this.aim && row.dataset.id === this.aim.id) row.classList.add(`is-${this.aim.at}`);
    }
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
      this.collapsed.add(id);
    } else {
      this.expanded.add(id);
      this.collapsed.delete(id);
    }
    this.render();
  }

  /* ── клавиатура ────────────────────────────────────────────────────────
     Дерево — один элемент табуляции, внутри которого ходят стрелками: тридцать
     строк, каждая со своим табом, превратили бы переход к редактору в тридцать
     нажатий. */

  private onKey(event: KeyboardEvent): void {
    if (this.draft) return;
    const at = this.flat.findIndex((node) => node.id === this.selectedId);
    const node = at >= 0 ? this.flat[at]! : null;

    const go = (index: number) => {
      const next = this.flat[Math.max(0, Math.min(this.flat.length - 1, index))];
      if (!next) return;
      this.selectedId = next.id;
      this.render();
      this.host.querySelector(".tree-row.is-selected")?.scrollIntoView({ block: "nearest" });
      this.callbacks.onSelect(next);
    };

    switch (event.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at < 0 ? 0 : at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(this.flat.length - 1);
        break;
      case "ArrowRight":
        if (!node) return;
        if (node.kind === "folder" && !this.expanded.has(node.id)) this.toggle(node.id);
        else go(at + 1);
        break;
      case "ArrowLeft":
        if (!node) return;
        if (node.kind === "folder" && this.expanded.has(node.id)) this.toggle(node.id);
        else if (node.parentId) {
          this.selectedId = node.parentId;
          this.render();
          this.callbacks.onSelect(this.byId.get(node.parentId)!);
        }
        break;
      case "F2":
        if (node) this.beginRename(node.id);
        break;
      case "Delete":
        if (node) this.callbacks.onDelete(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /* ── меню правой кнопки ────────────────────────────────────────────────
     Отвечает на «куда» самим местом нажатия. Кнопки наверху кладут в
     выбранное, но что выбрано — нужно помнить; здесь помнить нечего. */

  private openMenu(event: MouseEvent, node: TreeNode | null): void {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "tree-menu";
    menu.setAttribute("role", "menu");

    const item = (label: string, run: () => void, kind?: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = kind ? `tree-menu__item is-${kind}` : "tree-menu__item";
      button.textContent = label;
      button.onclick = () => {
        this.closeMenu();
        run();
      };
      menu.append(button);
    };
    const rule = () => menu.append(make("div", "tree-menu__rule", ""));

    const inside = node?.kind === "folder" ? node.id : (node?.parentId ?? null);
    const where = node?.kind === "folder" ? `в «${node.name}»` : "рядом";

    item(`Новая запись ${where}`, () => this.beginCreate("record", inside));
    item(`Новая папка ${where}`, () => this.beginCreate("folder", inside));

    if (node?.kind === "folder") {
      rule();
      const cover = (this.childrenOf.get(node.id) ?? []).find((child) => child.name === COVER);
      item(cover ? "Открыть титульный лист" : "Завести титульный лист", () =>
        this.callbacks.onCover(node),
      );
    }

    if (node) {
      rule();
      item("Переименовать", () => this.beginRename(node.id));
      if (node.parentId) item("Поднять на уровень выше", () => this.callbacks.onMove(node.id, parentOf(this.byId, node)));
      rule();
      item("Удалить", () => this.callbacks.onDelete(node), "danger");
    }

    // Ставится в поток документа, а не дерева: дерево прокручивается, а меню
    // должно остаться там, где на него нажали.
    document.body.append(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - box.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - box.height - 8)}px`;
    this.menu = menu;
    menu.querySelector("button")?.focus();
    menu.addEventListener("keydown", (keys) => {
      if (keys.key === "Escape") this.closeMenu();
    });
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}

function parentOf(byId: Map<string, TreeNode>, node: TreeNode): string | null {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  return parent?.parentId ?? null;
}

function byOrder(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.order - b.order || a.name.localeCompare(b.name, "ru");
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
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
