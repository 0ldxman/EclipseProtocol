/**
 * Командная строка — основной способ перемещения по вики.
 *
 * Две панели: список слева, разворот справа. Разворот здесь не украшение.
 * В вики половина попаданий приходится на однокоренные названия — «Меридиан»,
 * «Меридианский пакт», «Падение Меридиана», — и выбрать между ними по одной
 * строке нельзя. Поэтому путь, отрывок и допуск показываются до нажатия ввода.
 *
 * Приставка в начале строки сама переключает область поиска: `#` метки,
 * `/` категории, `>` команды. Панель областей остаётся подсказкой, а не
 * пультом, по которому нужно щёлкать.
 */

import { href, navigate } from "./app-root.js";
import { nav, search, type NavNode, type SearchHit } from "./api.js";
import { el } from "./dom.js";

type Kind = "запись" | "категория" | "метка" | "команда";

interface Item {
  kind: Kind;
  icon: string;
  name: string;
  note: string;
  /** Путь в дереве, показывается в развороте. */
  path: string;
  /** Отрывок: где нашлось. */
  text: string;
  access: number;
  restricted: boolean;
  go: () => void;
}

interface Scope {
  key: string;
  prefix: string;
  kind: Kind | null;
}

const SCOPES: Scope[] = [
  { key: "все", prefix: "", kind: null },
  { key: "записи", prefix: "", kind: "запись" },
  { key: "категории", prefix: "/", kind: "категория" },
  { key: "метки", prefix: "#", kind: "метка" },
  { key: "команды", prefix: ">", kind: "команда" },
];

const DEBOUNCE_MS = 120;

let root: HTMLElement | null = null;
let field: HTMLInputElement;
let list: HTMLElement;
let preview: HTMLElement;
let scopeBar: HTMLElement;

let items: Item[] = [];
let active = 0;
let scope = 0;
let generation = 0;
let tree: NavNode[] = [];

/* ── данные ───────────────────────────────────────────────────────────── */

function pathOf(node: NavNode): string {
  const parts: string[] = [];
  let cursor: NavNode | undefined = node;
  while (cursor?.parentId) {
    const parent = tree.find((n) => n.id === cursor!.parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent;
  }
  return ["архив", ...parts].join(" / ");
}

function commands(): Item[] {
  const open = (path: string) => () => {
    window.location.href = href("/") + path;
  };
  return [
    {
      kind: "команда", icon: "›", name: "открыть карту", note: "переход",
      path: "/map/", text: "Границы на любую дату из хронологии.",
      access: 0, restricted: false, go: open("map/"),
    },
    {
      kind: "команда", icon: "›", name: "открыть админку", note: "переход",
      path: "/admin/", text: "Правка записей и дерева категорий.",
      access: 0, restricted: false, go: open("admin/"),
    },
  ];
}

function folderItems(query: string): Item[] {
  return tree
    .filter((node) => node.kind === "folder" && node.name.toLowerCase().includes(query))
    .map((node) => ({
      kind: "категория" as const,
      icon: "▪",
      name: node.name,
      note: `${tree.filter((n) => n.parentId === node.id).length} внутри`,
      path: pathOf(node),
      text: node.access > 0 ? `Раздел закрыт: требуется допуск ${node.access}.` : "Раздел архива.",
      access: node.access,
      restricted: node.access > 0,
      go: () => navigate(`/folder/${node.id}`),
    }));
}

function tagItems(query: string): Item[] {
  const counts = new Map<string, number>();
  for (const node of tree) {
    for (const tag of node.tags) {
      if (tag.toLowerCase().includes(query)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([tag, count]) => ({
    kind: "метка" as const,
    icon: "#",
    name: tag,
    note: `${count} записей`,
    path: "метки",
    text: "Метка живёт поперёк категорий: одна запись может нести сколько угодно меток.",
    access: 0,
    restricted: false,
    // Отдельного экрана меток пока нет — метка ведёт в поиск по себе же.
    go: () => {
      field.value = tag;
      scope = 0;
      void refresh();
    },
  }));
}

function hitItems(hits: SearchHit[]): Item[] {
  return hits.map((hit) => {
    const node = tree.find((n) => n.slug === hit.slug);
    return {
      kind: "запись" as const,
      icon: hit.restricted ? "◇" : "◆",
      name: hit.title,
      note: hit.restricted ? "закрыто" : (node ? pathOf(node).split(" / ").pop() ?? "" : ""),
      path: node ? pathOf(node) : "архив",
      text: hit.snippet || "Совпадение в названии.",
      access: hit.access,
      restricted: hit.restricted,
      go: () => navigate(`/wiki/${hit.slug}`),
    };
  });
}

/* ── отрисовка ────────────────────────────────────────────────────────── */

function markup(text: string, needle: string): (Node | string)[] {
  if (!needle) return [text];
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return [text];
  return [
    text.slice(0, at),
    el("mark", {}, [text.slice(at, at + needle.length)]),
    text.slice(at + needle.length),
  ];
}

function clearanceMeter(level: number, of = 5): HTMLElement {
  return el(
    "span",
    { class: "clr" },
    Array.from({ length: of }, (_, i) => el("i", { class: i < Math.max(level, 1) ? "on" : "" })),
  );
}

function drawPreview(item: Item | undefined, needle: string): void {
  if (!item) {
    preview.replaceChildren(
      el("div", { class: "kind" }, ["разворот"]),
      el("p", { class: "txt", style: "margin-top:13px" }, [
        "Выберите строку слева — здесь появится путь, отрывок и допуск, чтобы не открывать запись ради проверки.",
      ]),
    );
    return;
  }

  const meta = el("dl", { class: "kv" }, [
    el("dt", {}, ["вид"]),
    el("dd", {}, [item.kind]),
    el("dt", {}, ["допуск"]),
    el("dd", {}, [clearanceMeter(item.access)]),
  ]);

  preview.replaceChildren(
    el("div", { class: "kind" }, [item.restricted ? `${item.kind} · закрыто` : item.kind]),
    el("h4", {}, [item.name]),
    el("div", { class: "path" }, [item.path]),
    el("hr", {}),
    el("div", { class: "txt" }, markup(item.text, needle)),
    el("div", { class: "meta" }, [meta]),
  );
}

function draw(needle: string): void {
  [...scopeBar.children].forEach((node, i) => node.classList.toggle("on", i === scope));

  if (items.length === 0) {
    list.replaceChildren(
      el("div", { class: "empty" }, [
        el("b", {}, [needle ? "ничего не найдено" : "начните набирать"]),
        el("span", {}, [
          needle
            ? "Проверьте раскладку или сузьте запрос."
            : "Название записи, категории или метки.",
          el("br"),
          "# — метки, / — категории, > — команды.",
        ]),
      ]),
    );
    drawPreview(undefined, needle);
    return;
  }

  const rows: Node[] = [];
  let group = "";
  items.forEach((item, i) => {
    if (item.kind !== group) {
      group = item.kind;
      rows.push(el("div", { class: "pal__cap" }, [group]));
    }
    const row = el("div", { class: `pal__row${i === active ? " on" : ""}` }, [
      el("em", {}, [item.icon]),
      el("b", {}, markup(item.name, needle)),
      el("s", { class: item.restricted ? "lock" : "" }, [item.note]),
    ]);
    row.addEventListener("mousemove", () => {
      if (active !== i) {
        active = i;
        draw(needle);
      }
    });
    row.addEventListener("click", () => choose());
    rows.push(row);
  });

  list.replaceChildren(...rows);
  drawPreview(items[active], needle);
}

/* ── поведение ────────────────────────────────────────────────────────── */

function parse(): { scope: number; query: string } {
  const raw = field.value;
  const found = SCOPES.findIndex((s) => s.prefix && raw.startsWith(s.prefix));
  if (found > 0) return { scope: found, query: raw.slice(1).trim().toLowerCase() };
  return { scope, query: raw.trim().toLowerCase() };
}

async function refresh(): Promise<void> {
  const mine = ++generation;
  const { scope: sc, query } = parse();
  const wanted = SCOPES[sc]!.kind;

  const local: Item[] = [];
  if (!wanted || wanted === "категория") local.push(...folderItems(query));
  if (!wanted || wanted === "метка") local.push(...tagItems(query));
  if (!wanted || wanted === "команда") {
    local.push(...commands().filter((item) => !query || item.name.includes(query)));
  }

  let hits: Item[] = [];
  if ((!wanted || wanted === "запись") && query.length >= 2) {
    const { results } = await search(query).catch(() => ({ results: [] as SearchHit[] }));
    if (mine !== generation) return;
    hits = hitItems(results);
  }

  // Записи идут первыми: чаще всего ищут именно их.
  items = [...hits, ...local];
  active = Math.min(active, Math.max(0, items.length - 1));
  draw(query);
}

function choose(): void {
  const item = items[active];
  if (!item) return;
  close();
  item.go();
}

function close(): void {
  root?.removeAttribute("open");
}

function build(): HTMLElement {
  field = el("input", {
    id: "pal-q",
    placeholder: "запись, категория, метка или команда…",
    autocomplete: "off",
    spellcheck: "false",
  });
  list = el("div", { class: "pal__list" });
  preview = el("div", { class: "pal__prev" });
  scopeBar = el(
    "div",
    { class: "pal__scopes" },
    SCOPES.map((s, i) => {
      const node = el("span", { class: i === 0 ? "on" : "" }, [
        s.prefix ? el("b", {}, [s.prefix]) : null,
        s.prefix ? ` ${s.key}` : s.key,
      ]);
      node.addEventListener("click", () => {
        scope = i;
        field.value = "";
        active = 0;
        void refresh();
        field.focus();
      });
      return node;
    }),
  );

  const box = el("div", { class: "pal__box" }, [
    el("i", {}),
    el("i", {}),
    el("i", {}),
    el("i", {}),
    el("div", { class: "pal__in" }, [
      el("b", {}, ["aether@eclipse"]),
      el("s", {}, [":~$"]),
      field,
      el("kbd", {}, ["ESC"]),
    ]),
    scopeBar,
    el("div", { class: "pal__panes" }, [list, preview]),
    el("div", { class: "pal__foot" }, [
      el("span", {}, [el("em", {}, ["↑↓"]), " выбор"]),
      el("span", {}, [el("em", {}, ["↵"]), " открыть"]),
      el("span", {}, [el("em", {}, ["⇥"]), " область"]),
      el("span", {}, [el("em", {}, ["esc"]), " закрыть"]),
      el("span", { class: "sp" }, ["CTRL+K"]),
    ]),
  ]);

  const overlay = el("div", { class: "pal" }, [box]);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  let timer = 0;
  field.addEventListener("input", () => {
    active = 0;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), DEBOUNCE_MS);
  });

  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      draw(parse().query);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      draw(parse().query);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose();
    } else if (event.key === "Tab") {
      event.preventDefault();
      scope = (scope + (event.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length;
      field.value = "";
      active = 0;
      void refresh();
    }
  });

  document.body.append(overlay);
  return overlay;
}

export function openSearch(): void {
  root ??= build();
  root.setAttribute("open", "");
  field.value = "";
  active = 0;
  scope = 0;
  items = [];
  draw("");
  field.focus();

  // Дерево нужно для путей, счётчиков и меток. Тянем один раз и кешируем.
  void nav()
    .then(({ nodes }) => {
      tree = nodes;
      return refresh();
    })
    .catch(() => undefined);
}
