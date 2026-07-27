/**
 * Админка вики: файловый менеджер над markdown-записями с совместным
 * редактором и живым просмотром.
 *
 * Редактор — CodeMirror, привязанный к `Y.Text`, поэтому вместе правят сам
 * исходник разметки. В этом весь смысл выбора: визуальный редактор превратил
 * бы markdown в экспорт с потерями, а файловый менеджер — в украшение; здесь
 * документ на экране и `.md` на диске — одно и то же.
 *
 * Просмотр рисует сервер тем же кодом, что и публичная страница. Второй
 * разборщик разметки в браузере был бы вторым набором ошибок.
 *
 * Всё, что меняет запись, живёт в одном месте — вкладке «Свойства». Слаг,
 * метки и допуск раньше не редактировались вовсе: дерево умело только имя,
 * и метка, по которой ищет читатель, ни разу не могла быть проставлена.
 *
 * Четвёртая вертикаль здесь так и не появилась. Каталог вложений занимает обе
 * правые (у файла нет «источника» и «результата»), а настройки архива —
 * плоскость поверх: раздел открывают, чтобы поправить одно число, и отдавать
 * ему колонку было бы неправдой о том, как часто туда смотрят.
 */

import "@aether/theme/theme.css";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { Api, ApiError, type NodeKind, type RenderResult, type TreeNode } from "./api";
import { AssetsView, markupFor } from "./assets-view";
import { baseDir } from "./base-path";
import { CollabClient, collabUrl, type ConnectionState } from "./collab";
import { Panes } from "./panes";
import { SettingsView } from "./settings-view";
import { glyph, SNIPPETS, type Snippet } from "./toolbar";
import { TreeView } from "./tree-view";

// Админка отдаётся из `<root>/admin/`, а API и сокеты живут в `<root>`.
const APP_BASE = baseDir();
const API_BASE = APP_BASE.replace(/\/admin$/, "");
const api = new Api(API_BASE);

const PRESENCE_COLOURS = ["#4f7cff", "#e2453c", "#37a06b", "#d9a441", "#8a5cd6", "#2fa8b8"];

function pickColour(): string {
  return PRESENCE_COLOURS[Math.floor(Math.random() * PRESENCE_COLOURS.length)]!;
}

/** Имя записи-обложки. Договорённость общая с сервером и публичной вики. */
const COVER = "_cover";

/** Заготовка титульного листа категории. */
const COVER_TEMPLATE = (name: string): string =>
  [
    '::::::cover{theme=black-red pattern=rays org="Архивная служба" volume="том I"}',
    `# ${name}`,
    "",
    ':::::epigraph{cite="источник"}',
    "Строка, с которой начинается раздел.",
    ":::::",
    "",
    ":::::columns",
    "О чём этот раздел и по каким источникам он ведётся.",
    "",
    "::::right",
    ":::fields",
    "записей :: 0",
    "охват :: 2027—2033",
    ":::",
    "",
    "::stamp[для служебного пользования]",
    "::::",
    ":::::",
    "::::::",
    "",
  ].join("\n");

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

async function main(): Promise<void> {
  const treeHost = document.getElementById("tree")!;
  const editorHost = document.getElementById("editor")!;
  const previewHost = document.getElementById("preview")!;
  const propsHost = document.getElementById("props")!;
  const titleEl = document.getElementById("record-title")!;
  const breadcrumbEl = document.getElementById("breadcrumb")!;
  const actionsEl = document.getElementById("record-actions")!;
  const statusEl = document.getElementById("status")!;
  const warningsEl = document.getElementById("warnings")!;
  const presenceEl = document.getElementById("presence")!;
  const insertBar = document.getElementById("insert-bar")!;
  const countEl = document.getElementById("tree-count")!;
  const shelfButton = document.getElementById("shelf-assets") as HTMLButtonElement;
  const shelfCount = document.getElementById("shelf-count")!;

  const previewBody = document.getElementById("preview-body")!;
  const sheet = document.getElementById("preview-sheet")!;

  let nodes: TreeNode[] = [];
  let current: TreeNode | null = null;
  let collab: CollabClient | null = null;
  let view: EditorView | null = null;
  let renderTimer: number | null = null;

  /* ── ширины вертикалей ────────────────────────────────────────────────── */
  const panes = new Panes(document.body);
  panes.attach(document.getElementById("tree-gutter")!, "tree", 1);
  panes.attach(document.getElementById("view-gutter")!, "view", -1);

  /* ── вкладки правой колонки ───────────────────────────────────────────── */
  function selectTab(name: "preview" | "props"): void {
    for (const tab of document.querySelectorAll<HTMLButtonElement>("#view-tabs button")) {
      tab.classList.toggle("on", tab.dataset.tab === name);
    }
    previewBody.hidden = name !== "preview";
    propsHost.hidden = name !== "props";
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>("#view-tabs button")) {
    tab.onclick = () => selectTab(tab.dataset.tab as "preview" | "props");
  }

  function note(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", isError);
  }

  /** Любое действие над деревом сообщает об отказе, а не молчит. */
  async function guard<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (error) {
      note(error instanceof ApiError ? error.message : String(error), true);
      return null;
    }
  }

  /* ── каталог вложений ─────────────────────────────────────────────────── */

  const assets = new AssetsView(document.getElementById("assets-pane")!, api, API_BASE, {
    // Вставка возвращает к записи: файл кладут в текст, а не в каталог, и
    // остаться после этого в каталоге значило бы не показать результат.
    insert: (markup) => {
      showRecordPanes();
      insertText(markup, false);
    },
    canInsert: () => view !== null,
    note,
  });

  function showAssets(): void {
    document.body.classList.add("is-assets");
    shelfButton.classList.add("is-on");
    void assets.show();
  }

  function showRecordPanes(): void {
    document.body.classList.remove("is-assets");
    shelfButton.classList.remove("is-on");
  }

  shelfButton.onclick = () => {
    if (document.body.classList.contains("is-assets")) showRecordPanes();
    else showAssets();
  };

  /* ── настройки архива ─────────────────────────────────────────────────── */

  const settings = new SettingsView(document.getElementById("settings")!, api, note);
  document.getElementById("open-settings")!.onclick = () => void settings.show();

  /* ── дерево ───────────────────────────────────────────────────────────── */

  const tree = new TreeView(treeHost, {
    onSelect: (node) => {
      showRecordPanes();
      if (node.kind === "record") void openRecord(node);
      else showFolder(node);
    },
    onMove: async (id, parentId, order) => {
      const patch = order === undefined ? { parentId } : { parentId, order };
      if (await guard(() => api.update(id, patch))) await refreshTree();
    },
    onRename: async (node, name) => {
      if (await guard(() => api.rename(node.id, name))) {
        await refreshTree();
        if (current?.id === node.id) refreshSelected();
      }
    },
    onCreate: async (kind, name, parentId, order) => {
      const node = await guard(() => api.create(kind, name, parentId));
      if (!node) return;
      // Порядок ставится вторым запросом: создание кладёт в конец, а строка
      // могла быть набрана посреди списка.
      if (order !== undefined) await guard(() => api.update(node.id, { order }));
      await refreshTree();
      tree.select(node.id);
      showRecordPanes();
      if (node.kind === "record") await openRecord(node);
      else showFolder(node);
    },
    onDelete: (node) => {
      tree.select(node.id);
      if (node.kind === "record") void openRecord(node);
      else showFolder(node);
      // Спрашиваем там же, где обычно: одна и та же форма подтверждения,
      // сколько бы путей к удалению ни вело.
      const remove = actionsEl.querySelector<HTMLElement>(".btn--danger");
      if (remove) confirmDelete(node, remove);
    },
    onCover: (folder) => {
      const cover = nodes.find((n) => n.parentId === folder.id && n.name === COVER);
      void openOrCreateCover(folder, cover);
    },
  });

  async function refreshTree(): Promise<void> {
    const result = await api.tree();
    nodes = result.nodes;
    tree.setNodes(nodes);
    const records = nodes.filter((n) => n.kind === "record").length;
    countEl.textContent = `${nodes.length - records} папок · ${records} записей`;
    note("готово");
  }

  /** Куда ляжет новое: в выбранную папку, рядом с выбранной записью, иначе в корень. */
  function targetParent(): string | null {
    const selected = tree.selected;
    if (!selected) return null;
    return selected.kind === "folder" ? selected.id : selected.parentId;
  }

  function chainOf(node: TreeNode): TreeNode[] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const chain: TreeNode[] = [];
    let cursor = byId.get(node.parentId ?? "");
    const guardSet = new Set<string>();
    while (cursor && !guardSet.has(cursor.id)) {
      guardSet.add(cursor.id);
      chain.unshift(cursor);
      cursor = byId.get(cursor.parentId ?? "");
    }
    return chain;
  }

  /* ── редактор ─────────────────────────────────────────────────────────── */

  function closeRecord(): void {
    view?.destroy();
    view = null;
    collab?.destroy();
    collab = null;
    current = null;
    editorHost.replaceChildren();
    previewHost.replaceChildren();
    titleEl.textContent = "Ничего не выбрано";
    breadcrumbEl.textContent = "";
    actionsEl.replaceChildren();
    warningsEl.replaceChildren();
    presenceEl.textContent = "";
    insertBar.hidden = true;
  }

  function schedulePreview(): void {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    // С задержкой: просмотр — поход на сервер, и рисовать на каждое нажатие
    // и расточительно, и рябит в глазах.
    renderTimer = window.setTimeout(() => void renderPreview(), 250);
  }

  async function renderPreview(): Promise<void> {
    if (!view) return;
    const source = view.state.doc.toString();
    try {
      const result: RenderResult = await api.render(source);
      previewHost.innerHTML = result.html;
      rebaseAssets(previewHost);
      showWarnings(result);
    } catch (error) {
      note(`просмотр недоступен: ${(error as Error).message}`, true);
    }
  }

  /**
   * Вложения в разметке адресуются относительно корня сайта (`uploads/…`), а
   * админка отдаётся из `/admin/`, поэтому в просмотре они бы искались этажом
   * ниже. Правится здесь, а не в разметке: на сайте адрес верный.
   */
  function rebaseAssets(root: HTMLElement): void {
    const base = API_BASE || "";
    for (const node of root.querySelectorAll<HTMLElement>("[src], [href]")) {
      for (const attribute of ["src", "href", "poster"] as const) {
        const value = node.getAttribute(attribute);
        if (value?.startsWith("uploads/")) node.setAttribute(attribute, `${base}/${value}`);
      }
    }
  }

  function showWarnings(result: RenderResult): void {
    warningsEl.replaceChildren();
    const add = (text: string, kind: string) => {
      warningsEl.append(el("span", { class: `chip is-${kind}` }, [text]));
    };
    for (const name of result.unknown) add(`неизвестный виджет: ${name}`, "warn");
    for (const slug of result.brokenLinks) add(`нет записи: ${slug}`, "info");
    if (result.links.length) add(`ссылок: ${result.links.length}`, "ghost");
  }

  /**
   * Вставка текста на место курсора.
   *
   * Блочная заготовка всегда начинается с новой строки и заканчивается пустой.
   * Иначе `:::quote` приклеивался к концу предыдущего абзаца, забор переставал
   * быть забором, и в тексте оставалась строка двоеточий — ровно та поломка,
   * из-за которой цитата «вставлялась неправильно».
   */
  function insertText(text: string, inline: boolean, select?: [number, number]): void {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc;
    let body = text;
    let shift = 0;

    if (!inline) {
      const before = doc.sliceString(Math.max(0, from - 2), from);
      const after = doc.sliceString(to, Math.min(doc.length, to + 2));
      const lead = from === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const tail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
      body = `${lead}${body}${tail}`;
      shift = lead.length;
    }

    view.dispatch({
      changes: { from, to, insert: body },
      selection: select
        ? { anchor: from + shift + select[0], head: from + shift + select[1] }
        : { anchor: from + body.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  /**
   * Вставка заготовки.
   *
   * Выделенное оборачивается, а не затирается: выделив слово и нажав
   * «спойлер», хочешь спрятать это слово. Раньше оно исчезало, и на его месте
   * появлялся образец из палитры.
   */
  function insert(snippet: Snippet): void {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const picked = view.state.doc.sliceString(from, to);

    if (snippet.wrap && picked) {
      const [open, close] = snippet.wrap;
      insertText(`${open}${picked}${close}`, Boolean(snippet.inline), [
        open.length,
        open.length + picked.length,
      ]);
      return;
    }
    insertText(snippet.text, Boolean(snippet.inline));
  }

  /* ── палитра разметки ─────────────────────────────────────────────────── */

  const filterTools = el("input", { type: "search", placeholder: "найти виджет" });
  insertBar.append(
    el("div", { class: "ins-head" }, [
      el("span", { class: "chrome" }, ["вставить"]),
      el("label", { class: "field ins-find" }, [filterTools]),
    ]),
  );

  for (const { group, items } of SNIPPETS) {
    const tools = el("div", { class: "ins-tools" });
    for (const snippet of items) {
      const button = el("button", { class: "tool", type: "button", title: snippet.title }, []);
      button.innerHTML = glyph(snippet.icon);
      button.append(el("span", {}, [snippet.label]));
      button.dataset.find = `${snippet.label} ${snippet.title}`.toLocaleLowerCase("ru");
      // Обложка — не заготовка на строку, а весь титульный лист: у неё уже
      // есть заполнитель, и незачем держать его в двух местах.
      button.onclick = () =>
        insert(
          snippet.label === "обложка"
            ? { ...snippet, text: COVER_TEMPLATE(current?.name ?? "Раздел").trimEnd() }
            : snippet,
        );
      tools.append(button);
    }
    insertBar.append(el("div", { class: "ins-row" }, [el("span", { class: "ins-label" }, [group]), tools]));
  }
  insertBar.hidden = true;

  // Фильтр не прячет язык разметки, а находит в нём: строки, где после отбора
  // не осталось ни одного виджета, уходят целиком, чтобы подпись группы не
  // висела над пустотой.
  filterTools.oninput = () => {
    const needle = filterTools.value.trim().toLocaleLowerCase("ru");
    for (const row of insertBar.querySelectorAll<HTMLElement>(".ins-row")) {
      let shown = 0;
      for (const tool of row.querySelectorAll<HTMLElement>(".tool")) {
        const hit = !needle || (tool.dataset.find ?? "").includes(needle);
        tool.classList.toggle("is-hidden", !hit);
        tool.classList.toggle("is-hit", Boolean(needle) && hit);
        if (hit) shown += 1;
      }
      row.classList.toggle("is-hidden", shown === 0);
    }
  };

  /* ── файл, брошенный в редактор ───────────────────────────────────────── */

  editorHost.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files") || !view) return;
    event.preventDefault();
    editorHost.classList.add("is-drop");
  });
  editorHost.addEventListener("dragleave", (event) => {
    if (!editorHost.contains(event.relatedTarget as Node)) editorHost.classList.remove("is-drop");
  });
  editorHost.addEventListener("drop", async (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0 || !view) return;
    event.preventDefault();
    editorHost.classList.remove("is-drop");
    for (const file of files) {
      note(`загрузка: ${file.name}`);
      const asset = await guard(() => api.upload(file));
      if (!asset) continue;
      insertText(markupFor(asset), false);
      note(`вставлено: ${asset.name}`);
    }
    void refreshShelf();
  });

  async function refreshShelf(): Promise<void> {
    const result = await api.assets().catch(() => null);
    if (result) shelfCount.textContent = String(result.assets.length);
    await assets.reload().catch(() => {});
  }

  async function openRecord(node: TreeNode): Promise<void> {
    if (current?.id === node.id) return;
    closeRecord();
    current = node;

    titleEl.textContent = node.name === COVER ? `Титульный лист · ${node.name}` : node.name;
    breadcrumbEl.textContent = [...chainOf(node).map((n) => n.name), node.slug ?? ""]
      .filter(Boolean)
      .join("  ›  ");
    renderActions(node);
    renderProps(node);
    insertBar.hidden = false;
    sheet.hidden = false;
    selectTab("preview");

    // Имя комнаты повторяет серверный `recordRoom()`.
    collab = new CollabClient(collabUrl(`record.${node.id}`, API_BASE));
    const text = collab.doc.getText("content");

    collab.awareness.setLocalStateField("user", {
      name: `Редактор ${collab.doc.clientID % 1000}`,
      color: pickColour(),
      colorLight: "#4f7cff33",
    });

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      yCollab(text, collab.awareness),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) schedulePreview();
      }),
      EditorView.theme(
        {
          "&": { height: "100%", fontSize: "13px", color: "var(--fg)" },
          ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
        },
        { dark: true },
      ),
    ];

    view = new EditorView({ state: EditorState.create({ extensions }), parent: editorHost });

    collab.onStateChange = (state: ConnectionState) => {
      presenceEl.dataset.state = state;
      if (state === "online") updatePresence();
      else presenceEl.textContent = state === "connecting" ? "подключение…" : "нет связи";
    };
    collab.awareness.on("change", updatePresence);

    // Документ приходит по сети; нарисовать нужно, как только он придёт.
    const seed = () => schedulePreview();
    text.observe(seed);
    window.setTimeout(seed, 400);
  }

  function updatePresence(): void {
    if (!collab) return;
    const others = [...collab.awareness.getStates().entries()].filter(
      ([id]) => id !== collab!.doc.clientID,
    );
    presenceEl.textContent = others.length === 0 ? "только вы" : `редактируют ещё: ${others.length}`;
  }

  /**
   * Папка редактором не открывается — у неё есть только свойства, поэтому
   * правая колонка сама переключается на них: пустой лист бумаги рядом с
   * пустым редактором ничего не сообщает.
   */
  function showFolder(node: TreeNode): void {
    closeRecord();
    current = node;
    titleEl.textContent = node.name;
    breadcrumbEl.textContent = chainOf(node).map((n) => n.name).join("  ›  ");
    renderActions(node);
    renderProps(node);
    sheet.hidden = true;
    selectTab("props");
    editorHost.replaceChildren(
      el("div", { class: "empty" }, [
        el("b", {}, ["категория"]),
        el("span", {}, [
          "У папки нет текста — только свойства и содержимое.",
          el("br"),
          "Титульный лист категории заводится кнопкой наверху.",
        ]),
      ]),
    );
  }

  /**
   * Перечитать выбранное, не трогая редактор.
   *
   * Правка свойства не должна ни перезапускать сеанс совместного набора, ни
   * уводить взгляд обратно на просмотр: человек в этот момент заполняет
   * соседнее поле.
   */
  function refreshSelected(): void {
    if (!current) return;
    const node = nodes.find((n) => n.id === current!.id);
    if (!node) return;
    current = node;
    titleEl.textContent =
      node.kind === "record" && node.name === COVER ? `Титульный лист · ${node.name}` : node.name;
    breadcrumbEl.textContent = [
      ...chainOf(node).map((n) => n.name),
      node.kind === "record" ? (node.slug ?? "") : "",
    ]
      .filter(Boolean)
      .join("  ›  ");
    renderActions(node);
    renderProps(node);
  }

  /* ── действия над выбранным ───────────────────────────────────────────── */

  function renderActions(node: TreeNode): void {
    actionsEl.replaceChildren();

    if (node.kind === "record" && node.slug && node.name !== COVER) {
      actionsEl.append(
        el(
          "a",
          {
            class: "btn btn--sm btn--ghost",
            href: `${API_BASE || "."}/#/wiki/${node.slug}`,
            target: "_blank",
            rel: "noopener",
          },
          ["на сайте ↗"],
        ),
      );
    }

    if (node.kind === "folder") {
      const cover = nodes.find((n) => n.parentId === node.id && n.name === COVER);
      const button = el("button", { class: "btn btn--sm", type: "button" }, [
        cover ? "титульный лист" : "+ титульный лист",
      ]);
      button.onclick = () => void openOrCreateCover(node, cover);
      actionsEl.append(button);
    }

    const remove = el("button", { class: "btn btn--sm btn--danger", type: "button" }, ["удалить"]);
    remove.onclick = () => confirmDelete(node, remove);
    actionsEl.append(remove);
  }

  /**
   * Удаление подтверждается на месте, а не системным окном: спрашивать надо,
   * показывая, сколько именно записей уйдёт вместе с папкой.
   */
  function confirmDelete(node: TreeNode, anchor: HTMLElement): void {
    const inside = countInside(node.id);
    const what =
      node.kind === "folder"
        ? `Удалить «${node.name}»${inside > 0 ? ` и ${inside} внутри` : ""}?`
        : `Удалить «${node.name}»?`;

    const box = el("span", { class: "row", style: "display:inline-flex;gap:6px;align-items:center" }, [
      el("span", { class: "chrome chrome--red" }, [what]),
    ]);
    const yes = el("button", { class: "btn btn--sm btn--danger", type: "button" }, ["да"]);
    const no = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, ["нет"]);
    box.append(yes, no);
    anchor.replaceWith(box);

    no.onclick = () => renderActions(node);
    yes.onclick = async () => {
      if (await guard(() => api.remove(node.id))) {
        closeRecord();
        propsHost.replaceChildren();
        await refreshTree();
        note(`удалено: ${node.name}`);
      } else {
        renderActions(node);
      }
    };
  }

  function countInside(id: string): number {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of nodes) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id);
          grew = true;
        }
      }
    }
    return ids.size - 1;
  }

  /**
   * Титульный лист — обычная запись с именем `_cover` внутри папки. Кнопка
   * существует потому, что догадаться об этой договорённости нельзя, а без
   * неё половина оформления категорий недоступна.
   */
  async function openOrCreateCover(folder: TreeNode, existing?: TreeNode): Promise<void> {
    showRecordPanes();
    if (existing) {
      tree.select(existing.id);
      await openRecord(existing);
      return;
    }
    const node = await guard(() => api.create("record", COVER, folder.id));
    if (!node) return;
    await refreshTree();
    tree.select(node.id);
    await openRecord(node);
    // Документ приходит по сети; заготовка кладётся только в пустую запись,
    // чтобы кнопка никогда не затирала чужой текст.
    window.setTimeout(() => {
      if (!view) return;
      if (view.state.doc.length > 40) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: COVER_TEMPLATE(folder.name) },
      });
    }, 700);
  }

  /* ── свойства ─────────────────────────────────────────────────────────── */

  function propBlock(label: string, body: Node[], hint?: string): HTMLElement {
    const block = el("div", { class: "prop" }, [el("span", { class: "chrome" }, [label])]);
    block.append(el("div", { class: "row" }, body));
    if (hint) block.append(el("div", { class: "note" }, [hint]));
    return block;
  }

  /**
   * Событие летописи.
   *
   * Карточка в ленте собирается целиком здесь: дата ставит запись в
   * хронологию, подпись и снимок — то, чем запись себя там показывает. Раньше
   * и подпись, и снимок выдирались из тела (первый абзац, первая картинка), и
   * карточка менялась от правки, которая её в виду не имела; к тому же начало
   * статьи в карточке всегда читалось обрывком.
   */
  function eventBlock(node: TreeNode): HTMLElement {
    const listed = Boolean(node.eventAt);
    const block = el("div", { class: "prop prop--event" }, [
      el("span", { class: "chrome" }, ["Событие"]),
    ]);

    const at = el("input", { type: "date", value: node.eventAt ?? "" });
    const epoch = el("input", {
      type: "text",
      value: node.eventEpoch ?? "",
      placeholder: "эпоха — можно не заполнять",
    });
    const summary = el("input", {
      type: "text",
      maxlength: "240",
      value: node.eventSummary ?? "",
      placeholder: "подпись в ленте — одна строка",
    });
    const image = el("input", {
      type: "text",
      value: node.eventImage ?? "",
      placeholder: "снимок: uploads/…",
    });
    const pick = el("button", { class: "btn btn--sm", type: "button" }, ["файл…"]);
    const file = el("input", { type: "file", accept: "image/*", hidden: "" });

    // Подпись и снимок без даты некуда показать, и незачем их принимать.
    for (const field of [summary, image, pick]) field.disabled = !listed;

    const apply = async (patch: Parameters<typeof api.update>[1]) => {
      if (await guard(() => api.update(node.id, patch))) {
        await refreshTree();
        refreshSelected();
      }
    };
    const onDone = (input: HTMLInputElement, was: string, send: (value: string) => void) => {
      const fire = () => {
        if (input.value.trim() === was) return;
        send(input.value.trim());
      };
      input.onkeydown = (event) => {
        if (event.key === "Enter") fire();
      };
      input.onblur = fire;
    };

    at.onchange = () => void apply({ eventAt: at.value });
    onDone(epoch, node.eventEpoch ?? "", (value) => void apply({ eventEpoch: value }));
    onDone(summary, node.eventSummary ?? "", (value) => void apply({ eventSummary: value }));
    onDone(image, node.eventImage ?? "", (value) => void apply({ eventImage: value }));

    pick.onclick = () => file.click();
    file.onchange = async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      note(`загрузка: ${chosen.name}`);
      const result = await guard(() => api.upload(chosen));
      if (!result) return;
      image.value = result.url;
      note(`снимок загружен: ${result.url}`);
      await apply({ eventImage: result.url });
      void refreshShelf();
    };

    block.append(
      el("div", { class: "row" }, [at, epoch]),
      el("div", { class: "row" }, [summary]),
      el("div", { class: "row" }, [image, pick, file]),
    );

    if (listed && node.eventImage) {
      const src = node.eventImage.startsWith("uploads/")
        ? `${API_BASE || ""}/${node.eventImage}`
        : node.eventImage;
      block.append(el("div", { class: "shot" }, [el("img", { src, alt: "" })]));
    }

    block.append(
      el("div", { class: "note" }, [
        listed
          ? "Подпись и снимок — то, чем событие показано в ленте. Пустая эпоха значит «до первой эпохи» и своей плашки не заводит."
          : "Без даты записи в летописи нет. Подпись и снимок для карточки появятся вместе с датой.",
      ]),
    );
    return block;
  }

  function renderProps(node: TreeNode): void {
    propsHost.replaceChildren();

    /* имя */
    const name = el("input", { type: "text", value: node.name });
    const applyName = async () => {
      const value = name.value.trim();
      if (!value || value === node.name) return;
      if (await guard(() => api.rename(node.id, value))) {
        await refreshTree();
        refreshSelected();
      }
    };
    name.onkeydown = (event) => {
      if (event.key === "Enter") void applyName();
    };
    name.onblur = () => void applyName();
    propsHost.append(propBlock("Название", [name]));

    /* слаг */
    if (node.kind === "record") {
      const slug = el("input", { type: "text", value: node.slug ?? "" });
      const fromName = el("button", { class: "btn btn--sm", type: "button" }, ["из названия"]);
      const applySlug = async (value: string) => {
        const wanted = value.trim();
        if (!wanted || wanted === node.slug) return;
        const updated = await guard(() => api.update(node.id, { slug: wanted }));
        if (!updated) {
          slug.value = node.slug ?? "";
          return;
        }
        await refreshTree();
        refreshSelected();
      };
      slug.onkeydown = (event) => {
        if (event.key === "Enter") void applySlug(slug.value);
      };
      slug.onblur = () => void applySlug(slug.value);
      fromName.onclick = () => void applySlug(node.name);
      propsHost.append(
        propBlock("Слаг", [slug, fromName], "Адрес записи и цель ссылок [[…]]. Меняется отдельно от названия."),
      );

      /* метки */
      const tags = el("input", {
        type: "text",
        value: (node.tags ?? []).join(", "),
        placeholder: "через запятую",
      });
      const applyTags = async () => {
        const list = tags.value.split(",").map((tag) => tag.trim()).filter(Boolean);
        if (list.join(",") === (node.tags ?? []).join(",")) return;
        if (await guard(() => api.update(node.id, { tags: list }))) {
          await refreshTree();
          refreshSelected();
        }
      };
      tags.onkeydown = (event) => {
        if (event.key === "Enter") void applyTags();
      };
      tags.onblur = () => void applyTags();
      propsHost.append(propBlock("Метки", [tags], "Метка живёт поперёк дерева: по ней собирается своя страница."));

      /* событие летописи */
      propsHost.append(eventBlock(node));
    }

    /* допуск */
    const levels = el("div", { class: "levels" });
    const own = node.accessLevel ?? 0;
    for (let level = 0; level <= 5; level++) {
      const button = el(
        "button",
        { type: "button", "data-level": String(level), class: level === own ? "on" : "" },
        [String(level)],
      );
      button.onclick = async () => {
        if (await guard(() => api.update(node.id, { accessLevel: level }))) {
          await refreshTree();
          refreshSelected();
        }
      };
      levels.append(button);
    }
    const inherited = node.effectiveAccess ?? 0;
    propsHost.append(
      propBlock(
        "Допуск",
        [levels],
        inherited > own
          ? `Наследуется от родителя: ${inherited}. Понизить ниже родителя нельзя.`
          : "0 — открыто всем. Уровень наследуется всем вложенным.",
      ),
    );

    /* родитель */
    const parent = el("select", { class: "" });
    parent.append(el("option", { value: "" }, ["— корень —"]));
    for (const folder of nodes.filter((n) => n.kind === "folder" && n.id !== node.id)) {
      const option = el("option", { value: folder.id }, [
        [...chainOf(folder).map((n) => n.name), folder.name].join(" / "),
      ]);
      if (folder.id === node.parentId) option.selected = true;
      parent.append(option);
    }
    parent.onchange = async () => {
      if (await guard(() => api.update(node.id, { parentId: parent.value || null }))) {
        await refreshTree();
        refreshSelected();
      }
    };
    const picker = el("div", { class: "pick" }, [parent]);
    propsHost.append(propBlock("Лежит в", [picker]));

    /* даты */
    const when = (iso: string) => new Date(iso).toLocaleString("ru-RU");
    propsHost.append(
      propBlock("Создано", [el("span", { class: "chrome chrome--plain" }, [when(node.createdAt)])]),
      propBlock("Изменено", [el("span", { class: "chrome chrome--plain" }, [when(node.updatedAt)])]),
    );
  }

  /* ── создание и фильтр ────────────────────────────────────────────────── */

  const create = (kind: NodeKind) => () => {
    showRecordPanes();
    tree.beginCreate(kind, targetParent());
  };
  document.getElementById("new-folder")!.onclick = create("folder");
  document.getElementById("new-record")!.onclick = create("record");

  const filter = document.getElementById("tree-filter-input") as HTMLInputElement;
  filter.oninput = () => tree.setFilter(filter.value);

  window.addEventListener("keydown", (event) => {
    // F2 работает откуда угодно; стрелки по дереву — только когда оно в фокусе,
    // иначе они бы уводили выделение из-под курсора в редакторе.
    if (event.key === "F2" && tree.selected && !settings.isOpen) {
      event.preventDefault();
      tree.beginRename(tree.selected.id);
    }
  });

  Object.assign(window as unknown as Record<string, unknown>, {
    __api: api,
    __openBySlug: async (slug: string) => {
      const node = nodes.find((n) => n.slug === slug);
      if (node) {
        tree.select(node.id);
        await openRecord(node);
      }
    },
    __openById: async (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node?.kind === "record") {
        tree.select(node.id);
        await openRecord(node);
      }
    },
    __source: () => view?.state.doc.toString() ?? "",
    __setSource: (value: string) => {
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
  });

  await refreshTree();
  const stored = await api.assets().catch(() => null);
  if (stored) shelfCount.textContent = String(stored.assets.length);
}

void main();
