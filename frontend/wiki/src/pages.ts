/**
 * Экраны читателя: запись, категория и главная.
 *
 * Все три собраны из одного правила — прибор и документ. Всё, что написал
 * автор, лежит на светлой бумаге; всё, что система вывела сама (слаг, дата,
 * обратные ссылки, соседи по категории, допуск), стоит в тёмных панелях
 * рядом. Читатель узнаёт источник сведений по материалу, не читая подписей.
 *
 * Инфобокс приходит уже отделённым от тела — сервер вынимает его при отдаче, —
 * и это единственное, что позволяет держать настоящую колонку, не заставляя
 * автора писать запись двумя кусками.
 */

import { href, navigate } from "./app-root.js";
import { nav, overview, record, type NavNode, type RecordPage } from "./api.js";
import { classifiedBody } from "./classified.js";
import { el } from "./dom.js";
import { setFootCount } from "./header.js";
import { hydrateWidgets } from "./hydrate.js";
import { openSearch } from "./search-palette.js";
import { articleToc } from "./toc.js";

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Русское склонение по числу: 1 запись, 2 записи, 5 записей. */
function plural(n: number, forms: [string, string, string]): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return `${n} ${forms[0]}`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

const RECORDS: [string, string, string] = ["запись", "записи", "записей"];

function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : DATE.format(at);
}

function link(route: string, text: string, className?: string): HTMLAnchorElement {
  const anchor = el("a", { class: className, href: href(route) }, [text]);
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(route);
  });
  return anchor;
}

/** Волосяные вертикали кадра: края колонки и граница боковой панели. */
function grid(withAside: boolean): HTMLElement {
  const marks = withAside
    ? ["calc(50% - 564px)", "calc(50% + 264px)", "calc(50% + 564px)"]
    : ["calc(50% - 564px)", "calc(50% + 564px)"];
  return el(
    "div",
    { class: "view__grid" },
    marks.map((left) => el("i", { style: `left:${left}` })),
  );
}

function clearanceMeter(level: number, of = 5): HTMLElement {
  return el(
    "span",
    { class: "clr" },
    Array.from({ length: of }, (_, i) => el("i", { class: i < level ? "on" : "" })),
  );
}

/** Панель прибора с ярлыком-вкладкой. */
function panel(tab: string, body: Node, tabClass?: string): HTMLElement {
  return el("div", { class: "panel ticks" }, [
    el("span", { class: `panel__tab ${tabClass ?? ""}`.trim() }, [tab]),
    body,
  ]);
}

function kv(rows: (readonly [Node | string, Node | string])[]): HTMLElement {
  const list = el("dl", { class: "kv" });
  for (const [key, value] of rows) {
    list.append(el("dt", {}, [key]), el("dd", {}, [value]));
  }
  return list;
}

/* ── запись ────────────────────────────────────────────────────────────── */

function contextStrip(page: RecordPage): HTMLElement {
  const trail: (Node | string)[] = [link("/", "архив")];
  for (const part of page.breadcrumb) {
    trail.push(el("s", {}, ["/"]), link(`/folder/${part.id}`, part.name));
  }
  trail.push(el("s", {}, ["/"]), el("span", { class: "chrome--on" }, [page.node.name]));

  return el("div", { class: "strip" }, [
    el("span", { class: "chrome" }, trail),
    page.node.slug ? el("span", { class: "chrome" }, [page.node.slug]) : null,
    page.backlinks.length > 0
      ? el("span", { class: "chrome" }, [`вх. ссылок ${page.backlinks.length}`])
      : null,
    page.restricted
      ? el("span", { class: "chrome chrome--red sp" }, [`требуется допуск ${page.access}`])
      : el("span", { class: "chrome sp" }, ["открыто"]),
  ]);
}

function paper(page: RecordPage): HTMLElement {
  const head = el("div", { class: "paper__head" }, [
    el("span", {}, [page.node.slug ? `запись · ${page.node.slug}` : "запись"]),
    el(
      "span",
      { class: "sp", style: page.restricted ? "color:#8f2f28" : "" },
      [page.restricted ? `закрыто · допуск ${page.access}` : "допуск 0 · открыто"],
    ),
    el("span", {}, [`изменено ${when(page.node.updatedAt)}`]),
  ]);

  const body = page.restricted
    ? classifiedBody(page.node.slug ?? page.node.id, page.hidden, page.access)
    : el("div", { class: "prose", html: page.html });

  // Записи принято начинать с `# Название`, а страница печатает название сама.
  // Снимаем ровно тот случай, когда первый заголовок первого уровня повторяет
  // имя записи, — документ, начинающийся с другого h1, остаётся нетронутым.
  const first = body.firstElementChild;
  if (!page.restricted && first?.tagName === "H1" && first.textContent?.trim() === page.node.name) {
    first.remove();
  }

  const inner = el("div", { class: "paper__in" }, [
    el("h1", { class: "rec" }, [page.node.name]),
    el("div", { class: "rec-rule" }),
  ]);

  // Вреза здесь нет намеренно: excerpt — это начало тела, а не отдельное
  // авторское предложение. Напечатать его над тем же абзацем значило бы
  // показать одну и ту же фразу дважды разными кеглями.
  inner.append(body);
  return el("article", { class: "paper" }, [head, inner]);
}

function recordAside(page: RecordPage): HTMLElement | null {
  const aside = el("aside", { class: "aside" });

  // Авторское — инфобоксы, как их написали. Дальше идёт то, что вывела система.
  if (!page.restricted) {
    for (const html of page.infoboxes) aside.insertAdjacentHTML("beforeend", html);
  }

  if (page.restricted) {
    aside.append(
      panel(
        "Гриф",
        kv([
          ["требуется", el("span", { style: "color:var(--red)" }, [`допуск ${page.access}`])],
          ["ваш уровень", "0"],
          ...(page.hidden
            ? ([
                ["разделов", String(page.hidden.sections)],
                ["знаков", page.hidden.chars.toLocaleString("ru-RU")],
              ] as const)
            : []),
        ]),
        "panel__tab--red",
      ),
    );
  }

  if (page.backlinks.length > 0) {
    aside.append(
      panel(
        "Ссылаются сюда",
        kv(page.backlinks.map((back) => [link(`/wiki/${back.slug}`, back.title), back.slug] as const)),
      ),
    );
  }

  const { prev, next } = page.siblings ?? { prev: null, next: null };
  if (prev || next) {
    aside.append(
      panel(
        "Рядом в категории",
        kv(
          [
            prev ? ([link(`/wiki/${prev.slug}`, `← ${prev.title}`), prev.slug] as const) : null,
            next ? ([link(`/wiki/${next.slug}`, `${next.title} →`), next.slug] as const) : null,
          ].filter(Boolean) as (readonly [Node, string])[],
        ),
      ),
    );
  }

  if (page.node.tags.length > 0) {
    aside.append(
      el("div", { class: "panel panel--flat" }, [
        el("div", { class: "chrome", style: "margin-bottom:9px" }, ["метки"]),
        el(
          "div",
          { style: "display:flex;gap:6px;flex-wrap:wrap" },
          page.node.tags.map((tag) => el("span", { class: "chip" }, [tag])),
        ),
      ]),
    );
  }

  if (page.restricted) {
    const ask = el("button", { class: "btn btn--go", type: "button" }, ["запросить допуск"]);
    ask.addEventListener("click", () => {
      ask.replaceChildren(document.createTextNode("вход не подключён"));
      ask.disabled = true;
    });
    aside.append(ask);
  }

  return aside.childElementCount > 0 ? aside : null;
}

export async function renderRecord(view: HTMLElement, slug: string): Promise<void> {
  let page: RecordPage;
  try {
    page = await record(slug);
  } catch {
    renderMissing(view, `Записи «${slug}» не существует.`);
    return;
  }

  const article = paper(page);
  const aside = recordAside(page);
  const row = el("div", { class: "body__in" }, [el("nav", { class: "toc-slot" }), article, aside]);

  view.replaceChildren(grid(aside !== null), contextStrip(page), el("div", { class: "body" }, [row]));

  // Рельс строится после того, как документ оказался в дереве: слежению за
  // прокруткой нужны настоящие заголовки с настоящими координатами.
  const slot = row.querySelector<HTMLElement>(".toc-slot")!;
  if (!page.restricted) {
    hydrateWidgets(article);
    const present = page.headings.filter((heading) => document.getElementById(heading.id) !== null);
    const rail = articleToc(present, document.documentElement);
    if (rail) slot.replaceWith(rail);
    else slot.remove();
  } else {
    slot.remove();
  }

  setFootCount(page.restricted ? "доступ ограничен" : "");
  document.title = `${page.node.name} — AETHER.WIKI`;
}

function renderMissing(view: HTMLElement, message: string): void {
  view.replaceChildren(
    grid(false),
    el("div", { class: "page" }, [
      el("div", { class: "empty" }, [
        el("b", {}, ["не найдено"]),
        el("span", {}, [
          message,
          el("br"),
          "Либо запись ещё не создана, либо слаг изменили.",
        ]),
      ]),
    ]),
  );
  document.title = "Не найдено — AETHER.WIKI";
}

/* ── картотека: папки-вкладки и списки ─────────────────────────────────── */

function sectionHead(title: string, note?: string): HTMLElement {
  return el("div", { class: "page__head" }, [
    el("h2", {}, [title]),
    note ? el("s", { class: "chrome" }, [note]) : null,
  ]);
}

function folderCards(nodes: NavNode[], parentId: string | null): HTMLElement | null {
  const folders = nodes
    .filter((node) => node.parentId === parentId && node.kind === "folder")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  if (folders.length === 0) return null;

  return el(
    "div",
    { class: "cards" },
    folders.map((folder) => {
      const inside = nodes.filter((node) => node.parentId === folder.id);
      const sealed = folder.access > 0;
      const card = link(`/folder/${folder.id}`, "", `folder${sealed ? " folder--sealed" : ""}`);
      card.append(
        el("b", {}, [folder.name]),
        el("s", {}, [
          sealed ? `требуется допуск ${folder.access}` : plural(inside.length, RECORDS),
        ]),
      );
      if (sealed) card.append(el("span", { class: "lock" }, ["▲"]));
      return card;
    }),
  );
}

function recordTable(nodes: NavNode[], parentId: string | null): HTMLElement | null {
  const records = nodes
    .filter((node) => node.parentId === parentId && node.kind === "record" && node.slug)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  if (records.length === 0) return null;

  const body = el(
    "tbody",
    {},
    records.map((node, i) =>
      el("tr", {}, [
        el("td", { class: "no" }, [String(i + 1).padStart(2, "0")]),
        el("td", { class: "nm" }, [
          link(`/wiki/${node.slug}`, node.name),
          node.access > 0
            ? el("span", { class: "pill pill--red", style: "margin-left:8px" }, [
                `допуск ${node.access}`,
              ])
            : null,
        ]),
        el("td", { class: "at" }, [when(node.updatedAt)]),
      ]),
    ),
  );
  return el("table", { class: "entries" }, [body]);
}

export async function renderFolder(view: HTMLElement, id: string): Promise<void> {
  const { nodes } = await nav();
  const folder = nodes.find((node) => node.id === id);
  if (!folder) {
    renderMissing(view, `Категории «${id}» не существует.`);
    return;
  }

  const trail: { id: string; name: string }[] = [];
  let cursor: NavNode | undefined = folder;
  while (cursor?.parentId) {
    const parent: NavNode | undefined = nodes.find((node) => node.id === cursor!.parentId);
    if (!parent) break;
    trail.unshift({ id: parent.id, name: parent.name });
    cursor = parent;
  }

  const crumbs: (Node | string)[] = [link("/", "архив")];
  for (const part of trail) {
    crumbs.push(el("s", {}, ["/"]), link(`/folder/${part.id}`, part.name));
  }
  crumbs.push(el("s", {}, ["/"]), el("span", { class: "chrome--on" }, [folder.name]));

  const inside = nodes.filter((node) => node.parentId === folder.id);
  const strip = el("div", { class: "strip" }, [
    el("span", { class: "chrome" }, crumbs),
    el("span", { class: "chrome" }, [`${inside.length} внутри`]),
    folder.access > 0
      ? el("span", { class: "chrome chrome--red sp" }, [`допуск ${folder.access}`])
      : el("span", { class: "chrome sp" }, ["открыто"]),
  ]);

  const page = el("div", { class: "page" }, [
    el("div", { class: "hero" }, [el("h1", {}, [folder.name])]),
  ]);

  const cards = folderCards(nodes, folder.id);
  if (cards) page.append(sectionHead("Подразделы"), cards);

  const table = recordTable(nodes, folder.id);
  if (table) page.append(sectionHead("Содержание", plural(inside.length, RECORDS)), table);
  if (!cards && !table) {
    page.append(
      el("div", { class: "empty" }, [
        el("b", {}, ["категория пуста"]),
        el("span", {}, ["Первая запись появится здесь, как только её создадут."]),
      ]),
    );
  }

  view.replaceChildren(grid(false), strip, page);
  setFootCount("");
  document.title = `${folder.name} — AETHER.WIKI`;
}

/* ── главная ───────────────────────────────────────────────────────────── */

export async function renderHome(view: HTMLElement): Promise<void> {
  const [{ nodes }, stats] = await Promise.all([nav(true), overview()]);

  const tags = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }

  const strip = el("div", { class: "strip" }, [
    el("span", { class: "chrome" }, ["архив «Eclipse Protocol»"]),
    el("span", { class: "chrome" }, [plural(stats.records, RECORDS)]),
    el("span", { class: "chrome" }, [plural(stats.folders, ["категория", "категории", "категорий"])]),
    stats.restricted > 0
      ? el("span", { class: "chrome" }, [`${stats.restricted} под грифом`])
      : null,
    el("span", { class: "chrome sp" }, [
      stats.recent[0] ? `обновлено ${when(stats.recent[0].updatedAt)}` : "",
    ]),
  ]);

  const search = el("div", { class: "cmd" }, [
    "поиск по архиву — запись, категория, метка",
    el("kbd", {}, ["CTRL K"]),
  ]);
  search.addEventListener("click", () => openSearch());

  const page = el("div", { class: "page" }, [
    el("div", { class: "hero" }, [
      el("h1", {}, ["ECLIPSE ", el("em", {}, ["PROTOCOL"])]),
      el("p", {}, [
        "Летопись протокола: люди, операции, места и то, что от них осталось в открытой части архива.",
      ]),
      search,
    ]),
  ]);

  const cards = folderCards(nodes, null);
  if (cards) page.append(sectionHead("Категории", `${stats.folders}`), cards);

  const loose = recordTable(nodes, null);
  if (loose) page.append(sectionHead("Вне категорий"), loose);

  if (tags.size > 0) {
    page.append(
      sectionHead("Метки", String(tags.size)),
      el(
        "div",
        { style: "display:flex;gap:7px;flex-wrap:wrap" },
        [...tags.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
          .map(([tag, count]) => el("span", { class: "chip" }, [tag, el("b", {}, [String(count)])])),
      ),
    );
  }

  const feed = el(
    "div",
    { class: "feed" },
    stats.recent.map((entry) => {
      const row = link(`/wiki/${entry.slug}`, "");
      row.append(
        el("time", {}, [when(entry.updatedAt)]),
        el("b", {}, [entry.title]),
        el("s", { class: entry.restricted ? "chrome--red" : "" }, [
          entry.restricted ? "под грифом" : "",
        ]),
      );
      return row;
    }),
  );

  const gates = el("div", { class: "gate" }, [
    el("a", { href: href("/") + "map/" }, [
      el("em", {}, ["↗"]),
      el("b", {}, ["Карта"]),
      el("s", {}, ["Границы на любую дату из хронологии."]),
    ]),
    el("a", { href: href("/") + "admin/" }, [
      el("em", {}, ["↗"]),
      el("b", {}, ["Админка"]),
      el("s", {}, ["Правка записей и дерева категорий."]),
    ]),
  ]);

  page.append(
    el("div", { class: "home-split" }, [
      el("div", {}, [
        sectionHead("Последние изменения"),
        stats.recent.length > 0
          ? feed
          : el("div", { class: "empty" }, [
              el("b", {}, ["архив пуст"]),
              el("span", {}, ["Первая запись появится здесь, как только её создадут."]),
            ]),
      ]),
      el("div", {}, [sectionHead("Другие входы"), gates]),
    ]),
  );

  view.replaceChildren(grid(false), strip, page);
  setFootCount(plural(stats.records, RECORDS));
  document.title = "AETHER.WIKI";
}
