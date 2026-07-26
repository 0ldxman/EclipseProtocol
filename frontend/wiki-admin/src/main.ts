/**
 * Wiki admin: a file manager over markdown records, with a collaborative
 * editor and live preview.
 *
 * The editor is CodeMirror bound to a `Y.Text`, so what several people edit
 * together is the markdown source itself. That is the whole reason for the
 * choice: a rich-text editor would make markdown a lossy export and turn the
 * file manager into decoration, whereas here the document on screen and the
 * `.md` file on disk are the same thing.
 *
 * Preview is rendered by the server, by the same code the public page uses.
 * A second parser in the browser would be a second set of bugs.
 */

import "@aether/theme/theme.css";

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import { Api, ApiError, type RenderResult, type TreeNode } from "./api";
import { baseDir } from "./base-path";
import { CollabClient, collabUrl, type ConnectionState } from "./collab";
import { TreeView } from "./tree-view";

// The admin is served from `<root>/admin/`, but the API and the collab
// sockets are mounted at `<root>`. Strip the app segment to reach them.
const APP_BASE = baseDir();
const API_BASE = APP_BASE.replace(/\/admin$/, "");
const api = new Api(API_BASE);

const PRESENCE_COLOURS = [
  "#4f7cff", "#e2453c", "#37a06b", "#d9a441", "#8a5cd6", "#2fa8b8",
];

function pickColour(): string {
  return PRESENCE_COLOURS[Math.floor(Math.random() * PRESENCE_COLOURS.length)]!;
}

async function main(): Promise<void> {
  const treeHost = document.getElementById("tree")!;
  const editorHost = document.getElementById("editor")!;
  const previewHost = document.getElementById("preview")!;
  const titleEl = document.getElementById("record-title")!;
  const breadcrumbEl = document.getElementById("breadcrumb")!;
  const statusEl = document.getElementById("status")!;
  const warningsEl = document.getElementById("warnings")!;
  const presenceEl = document.getElementById("presence")!;

  let nodes: TreeNode[] = [];
  let current: TreeNode | null = null;
  let collab: CollabClient | null = null;
  let view: EditorView | null = null;
  let renderTimer: number | null = null;

  const tree = new TreeView(treeHost, {
    onSelect: (node) => {
      if (node.kind === "record") void openRecord(node);
    },
    onMove: async (id, parentId) => {
      try {
        await api.update(id, { parentId });
        await refreshTree();
      } catch (error) {
        note(error instanceof ApiError ? error.message : String(error), true);
      }
    },
    onRename: async (node) => {
      const name = prompt("Название", node.name);
      if (name === null) return;
      await api.update(node.id, { name });
      await refreshTree();
    },
    onDelete: async (node) => {
      const what = node.kind === "folder" ? "папку со всем содержимым" : "запись";
      if (!confirm(`Удалить ${what} «${node.name}»?`)) return;
      await api.remove(node.id);
      if (current && (current.id === node.id || !nodes.some((n) => n.id === current?.id))) {
        closeRecord();
      }
      await refreshTree();
    },
  });

  function note(message: string, isError = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", isError);
  }

  async function refreshTree(): Promise<void> {
    const result = await api.tree();
    nodes = result.nodes;
    tree.setNodes(nodes);
    const records = nodes.filter((n) => n.kind === "record").length;
    const folders = nodes.length - records;
    note(`${folders} папок · ${records} записей`);
  }

  function breadcrumbOf(node: TreeNode): string[] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const chain: string[] = [];
    let cursor = byId.get(node.parentId ?? "");
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.unshift(cursor.name);
      cursor = byId.get(cursor.parentId ?? "");
    }
    return chain;
  }

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
    warningsEl.replaceChildren();
    presenceEl.textContent = "";
  }

  function schedulePreview(): void {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    // Debounced: preview is a server round-trip, and rendering on every
    // keystroke would be both wasteful and visually noisy.
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
      note(`превью недоступно: ${(error as Error).message}`, true);
    }
  }

  function showWarnings(result: RenderResult): void {
    warningsEl.replaceChildren();
    const add = (text: string, kind: string) => {
      const chip = document.createElement("span");
      chip.className = `chip is-${kind}`;
      chip.textContent = text;
      warningsEl.append(chip);
    };
    for (const name of result.unknown) add(`неизвестный виджет: ${name}`, "warn");
    for (const slug of result.brokenLinks) add(`нет записи: ${slug}`, "info");
    if (result.links.length) add(`ссылок: ${result.links.length}`, "ghost");
  }

  async function openRecord(node: TreeNode): Promise<void> {
    if (current?.id === node.id) return;
    closeRecord();
    current = node;

    titleEl.textContent = node.name;
    const chain = breadcrumbOf(node);
    breadcrumbEl.textContent = [...chain, node.slug ?? ""].filter(Boolean).join("  ›  ");

    // Room name mirrors the server's `recordRoom()`.
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
          "&": { height: "100%", fontSize: "13px", color: "var(--foreground)" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
        },
        { dark: true },
      ),
    ];

    view = new EditorView({
      state: EditorState.create({ extensions }),
      parent: editorHost,
    });

    collab.onStateChange = (state: ConnectionState) => {
      presenceEl.dataset.state = state;
      if (state === "online") updatePresence();
      else presenceEl.textContent = state === "connecting" ? "подключение…" : "нет связи";
    };
    collab.awareness.on("change", updatePresence);

    // The document arrives asynchronously; render once it has.
    const seed = () => schedulePreview();
    text.observe(seed);
    window.setTimeout(seed, 400);
  }

  function updatePresence(): void {
    if (!collab) return;
    const others = [...collab.awareness.getStates().entries()].filter(
      ([id]) => id !== collab!.doc.clientID,
    );
    presenceEl.textContent =
      others.length === 0 ? "только вы" : `редактируют ещё: ${others.length}`;
  }

  document.getElementById("new-folder")!.onclick = async () => {
    const name = prompt("Название папки", "Новая папка");
    if (!name) return;
    const selected = tree.selected;
    const parentId =
      selected?.kind === "folder" ? selected.id : (selected?.parentId ?? null);
    await api.create("folder", name, parentId);
    await refreshTree();
  };

  document.getElementById("new-record")!.onclick = async () => {
    const name = prompt("Название записи", "Новая запись");
    if (!name) return;
    const selected = tree.selected;
    const parentId =
      selected?.kind === "folder" ? selected.id : (selected?.parentId ?? null);
    const node = await api.create("record", name, parentId);
    await refreshTree();
    tree.select(node.id);
    await openRecord(node);
  };

  document.getElementById("set-access")!.onclick = async () => {
    const selected = tree.selected;
    if (!selected) return note("выберите папку или запись", true);
    const value = prompt(
      "Требуемый уровень допуска (0 — открыто).\nВложенное не может быть публичнее родителя.",
      String(selected.accessLevel ?? 0),
    );
    if (value === null) return;
    await api.update(selected.id, { accessLevel: Number(value) || 0 });
    await refreshTree();
  };

  Object.assign(window as unknown as Record<string, unknown>, {
    __api: api,
    __openBySlug: async (slug: string) => {
      const node = nodes.find((n) => n.slug === slug);
      if (node) {
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
