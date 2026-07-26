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
 */

import "@aether/theme/theme.css";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { Api, ApiError, type NodeKind, type RenderResult, type TreeNode } from "./api";
import { baseDir } from "./base-path";
import { CollabClient, collabUrl, type ConnectionState } from "./collab";
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

/**
 * Заготовки разметки.
 *
 * Язык виджетов иначе невидим: человек, открывший пустую запись, не может
 * догадаться ни про `:::infobox`, ни про число двоеточий у вложенных заборов.
 * Заготовка отвечает на оба вопроса сразу — её правят, а не сочиняют.
 */
const SNIPPETS: { label: string; title: string; text: string }[] = [
  {
    label: "инфобокс",
    title: "Карточка справа от текста",
    text: [
      "::::infobox{title=Досье}",
      ":::fields",
      "ключ :: значение",
      ":::",
      "",
      ":tag[Метка]{style=warn}",
      "::::",
      "",
    ].join("\n"),
  },
  {
    label: "поля",
    title: "Таблица «ключ — значение»",
    text: [":::fields", "ключ :: значение", ":::", ""].join("\n"),
  },
  {
    label: "заметка",
    title: "Выноска: справка, внимание, оспорено",
    text: [":::note{style=info}", "Текст заметки.", ":::", ""].join("\n"),
  },
  {
    label: "цитата",
    title: "Цитата с указанием источника",
    text: [':::quote{by="источник"}', "Текст цитаты.", ":::", ""].join("\n"),
  },
  {
    label: "картинка",
    title: "Изображение с подписью",
    text: '::image{src="uploads/файл.png" caption="Подпись"}\n\n',
  },
  {
    label: "событие",
    title: "Запись попадает в хронологию",
    text: '::event{at=2031-04-12 epoch="Разлом"}\n\n',
  },
  {
    label: "шкала",
    title: "Полоса и точки",
    text: "::bar{name=Готовность max=100 current=60}\n\n::dotbar{name=Допуск max=5 current=3}\n\n",
  },
  {
    label: "таблица",
    title: "Таблица markdown",
    text: ["| столбец | столбец |", "| --- | --- |", "| значение | значение |", ""].join("\n"),
  },
];

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

  let nodes: TreeNode[] = [];
  let current: TreeNode | null = null;
  let collab: CollabClient | null = null;
  let view: EditorView | null = null;
  let renderTimer: number | null = null;

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

  const tree = new TreeView(treeHost, {
    onSelect: (node) => {
      if (node.kind === "record") void openRecord(node);
      else showFolder(node);
    },
    onMove: async (id, parentId) => {
      if (await guard(() => api.update(id, { parentId }))) await refreshTree();
    },
    onRename: async (node, name) => {
      if (await guard(() => api.rename(node.id, name))) {
        await refreshTree();
        if (current?.id === node.id) showSelected();
      }
    },
    onCreate: async (kind, name, parentId) => {
      const node = await guard(() => api.create(kind, name, parentId));
      if (!node) return;
      await refreshTree();
      tree.select(node.id);
      if (node.kind === "record") await openRecord(node);
      else showFolder(node);
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
      showWarnings(result);
    } catch (error) {
      note(`просмотр недоступен: ${(error as Error).message}`, true);
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

  /** Вставка заготовки на место курсора. */
  function insert(text: string): void {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  for (const snippet of SNIPPETS) {
    const button = el("button", { class: "btn btn--sm", type: "button", title: snippet.title }, [
      snippet.label,
    ]);
    button.onclick = () => insert(snippet.text);
    insertBar.append(button);
  }
  insertBar.hidden = true;

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

  /** Папка редактором не открывается — у неё есть только свойства. */
  function showFolder(node: TreeNode): void {
    closeRecord();
    current = node;
    titleEl.textContent = node.name;
    breadcrumbEl.textContent = chainOf(node).map((n) => n.name).join("  ›  ");
    renderActions(node);
    renderProps(node);
    previewHost.replaceChildren(
      el("div", { class: "empty" }, [
        el("b", {}, ["папка"]),
        el("span", {}, ["У категории нет текста. Титульный лист — отдельная запись «_cover»."]),
      ]),
    );
  }

  function showSelected(): void {
    const node = tree.selected;
    if (!node) return;
    if (node.kind === "folder") showFolder(node);
    else {
      current = null;
      void openRecord(node);
    }
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

  function renderProps(node: TreeNode): void {
    propsHost.replaceChildren();

    /* имя */
    const name = el("input", { type: "text", value: node.name });
    const applyName = async () => {
      const value = name.value.trim();
      if (!value || value === node.name) return;
      if (await guard(() => api.rename(node.id, value))) {
        await refreshTree();
        showSelected();
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
        showSelected();
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
          showSelected();
        }
      };
      tags.onkeydown = (event) => {
        if (event.key === "Enter") void applyTags();
      };
      tags.onblur = () => void applyTags();
      propsHost.append(propBlock("Метки", [tags], "Метка живёт поперёк дерева: по ней собирается своя страница."));
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
          showSelected();
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
        showSelected();
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

  /* ── вкладки правой колонки ───────────────────────────────────────────── */

  const previewBody = document.getElementById("preview-body")!;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("#view-tabs button")) {
    tab.onclick = () => {
      for (const other of document.querySelectorAll("#view-tabs button")) {
        other.classList.toggle("on", other === tab);
      }
      previewBody.hidden = tab.dataset.tab !== "preview";
      propsHost.hidden = tab.dataset.tab !== "props";
    };
  }

  /* ── создание и фильтр ────────────────────────────────────────────────── */

  const create = (kind: NodeKind) => () => tree.beginCreate(kind, targetParent());
  document.getElementById("new-folder")!.onclick = create("folder");
  document.getElementById("new-record")!.onclick = create("record");

  const filter = document.getElementById("tree-filter-input") as HTMLInputElement;
  filter.oninput = () => tree.setFilter(filter.value);

  window.addEventListener("keydown", (event) => {
    if (event.key === "F2" && tree.selected) {
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
}

void main();
