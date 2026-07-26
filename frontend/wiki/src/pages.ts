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
import {
  folder as folderPage,
  nav,
  overview,
  record,
  timeline,
  type Belongs,
  type NavNode,
  type RecordPage,
  type TimelineEvent,
} from "./api.js";
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

/**
 * Волосяные вертикали кадра.
 *
 * Две всегда стоят по полям окна — это и есть корпус прибора. На странице
 * записи к ним добавляются границы дорожек: за рельсом якорей и перед
 * колонкой досье, чтобы было видно, что документ вставлен в раму, а не
 * положен на пустоту.
 */
function grid(withTracks: boolean): HTMLElement {
  const marks = ["var(--pad)", "calc(100% - var(--pad) - 1px)"];
  if (withTracks) marks.push("calc(50% - 700px)", "calc(50% + 700px)");
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

/**
 * Полоса принадлежности: герб и название ближайшей обложки вверх по дереву,
 * окрашенные её схемой.
 *
 * Цвет берётся не из JS, а из класса схемы: `cover--black-red` задаёт
 * `--cv-accent`, полоса им пользуется. Одна таблица соответствий вместо двух.
 */
function belongBand(belongs: Belongs): HTMLElement {
  const band = link(`/folder/${belongs.id}`, "", `belong ${belongs.theme ? `cover--${belongs.theme}` : ""}`.trim());
  band.append(
    el("i", {}, [
      belongs.logo ? el("img", { src: belongs.logo, alt: "" }) : el("span", {}, [belongs.mark || "◆"]),
    ]),
    el("span", {}, [el("b", {}, [belongs.name])]),
    el("span", { class: "sp chrome" }, ["титульный лист ↗"]),
  );
  return band;
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
          page.node.tags.map((tag) => link(`/tag/${encodeURIComponent(tag)}`, tag, "chip")),
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
  const middle = page.belongs
    ? el("div", { class: "paper-stack" }, [belongBand(page.belongs), article])
    : article;
  const row = el("div", { class: `body__in${aside ? "" : " body__in--bare"}` }, [
    el("nav", { class: "toc-slot" }),
    middle,
    aside,
  ]);

  view.replaceChildren(grid(aside !== null), contextStrip(page), el("div", { class: "body" }, [row]));

  // Рельс строится после того, как документ оказался в дереве: слежению за
  // прокруткой нужны настоящие заголовки с настоящими координатами.
  // Пустой рельс со страницы не убирается: дорожка под него — часть кадра, и
  // без неё документ съезжает в колонку якорей. Пуст он только визуально.
  const slot = row.querySelector<HTMLElement>(".toc-slot")!;
  if (!page.restricted) {
    hydrateWidgets(article);
    const present = page.headings.filter((heading) => document.getElementById(heading.id) !== null);
    const rail = articleToc(present, document.documentElement);
    if (rail) slot.replaceWith(rail);
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

function folderCards(nodes: NavNode[], parentId: string | null, tight = false): HTMLElement | null {
  const folders = nodes
    .filter((node) => node.parentId === parentId && node.kind === "folder")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  if (folders.length === 0) return null;

  return el(
    "div",
    { class: `cards${tight ? " cards--tight" : ""}` },
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

/**
 * Указатель записей.
 *
 * На широком кадре список из одних названий выглядит обрезанным не потому,
 * что он узкий, а потому, что в нём нечего читать справа. Поэтому строка
 * несёт всё, что о записи известно указателю: номер, название, метки, откуда
 * она (когда список собран поперёк дерева) и когда её трогали последний раз.
 */
function recordIndex(
  records: NavNode[],
  options: { origin?: (node: NavNode) => string } = {},
): HTMLElement {
  const rows = records.map((node, i) => {
    const tags = node.tags.slice(0, 3);
    return el("tr", {}, [
      el("td", { class: "no" }, [String(i + 1).padStart(2, "0")]),
      el("td", { class: "nm" }, [
        link(`/wiki/${node.slug}`, node.name),
        node.access > 0
          ? el("span", { class: "pill pill--red", style: "margin-left:9px" }, [
              `допуск ${node.access}`,
            ])
          : null,
      ]),
      el(
        "td",
        { class: "tg" },
        tags.length > 0
          ? [
              ...tags.map((tag) => link(`/tag/${encodeURIComponent(tag)}`, tag, "chip chip--sm")),
              node.tags.length > tags.length
                ? el("span", { class: "more" }, [`+${node.tags.length - tags.length}`])
                : null,
            ]
          : [el("span", { class: "more" }, ["—"])],
      ),
      options.origin ? el("td", { class: "og" }, [options.origin(node)]) : null,
      el("td", { class: "at" }, [when(node.updatedAt)]),
    ]);
  });

  return el("table", { class: "entries" }, [el("tbody", {}, rows)]);
}

function childRecords(nodes: NavNode[], parentId: string | null): NavNode[] {
  return nodes
    .filter((node) => node.parentId === parentId && node.kind === "record" && node.slug)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
}

/** Идентификаторы всей ветки, включая саму папку. */
function subtree(nodes: NavNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
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
  return ids;
}

/** Короткая лента событий для боковой колонки. */
function eventList(events: TimelineEvent[]): HTMLElement {
  return el(
    "div",
    { class: "mini" },
    events.map((event) => {
      const row = event.restricted
        ? el("div", { class: "mini__row mini__row--sealed" })
        : link(`/wiki/${event.slug}`, "", "mini__row");
      row.append(
        el("time", {}, [event.at.slice(0, 4)]),
        el("b", {}, [event.title]),
        el("s", {}, [event.restricted ? "гриф" : event.epoch]),
      );
      return row;
    }),
  );
}

function chipRow(entries: [string, number][]): HTMLElement {
  return el(
    "div",
    { class: "chips" },
    entries.map(([tag, count]) => {
      const chip = link(`/tag/${encodeURIComponent(tag)}`, tag, "chip");
      chip.append(el("b", {}, [String(count)]));
      return chip;
    }),
  );
}

function countTags(records: NavNode[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const node of records) {
    for (const tag of node.tags) tally.set(tag, (tally.get(tag) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
}

export async function renderFolder(view: HTMLElement, id: string): Promise<void> {
  const { nodes } = await nav();
  const folder = nodes.find((node) => node.id === id);
  if (!folder) {
    renderMissing(view, `Категории «${id}» не существует.`);
    return;
  }

  // Титульный лист есть не у каждой категории: тогда показывается обычное
  // оглавление, а не пустая рамка.
  const cover = await folderPage(id)
    .then((data) => data.cover)
    .catch(() => "");
  // Хронология нужна только боковой колонке; без неё страница обязана
  // собраться, поэтому отказ не поднимается выше.
  const chronology = await timeline().catch(() => ({ epochs: [], events: [] }));

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

  const page = el("div", { class: "page" }, []);
  if (cover) {
    page.append(el("div", { class: "cover-slot", html: cover }));
  } else {
    page.append(el("div", { class: "hero hero--cat" }, [el("h1", {}, [folder.name])]));
  }

  /* ── левая половина: что лежит в категории ── */
  const main = el("div", { class: "col" });
  const cards = folderCards(nodes, folder.id, true);
  if (cards) main.append(sectionHead("Подразделы"), cards);

  const records = childRecords(nodes, folder.id);
  if (records.length > 0) {
    main.append(sectionHead("Содержание", plural(records.length, RECORDS)), recordIndex(records));
  }
  if (!cards && records.length === 0) {
    main.append(
      el("div", { class: "empty" }, [
        el("b", {}, ["категория пуста"]),
        el("span", {}, ["Первая запись появится здесь, как только её создадут."]),
      ]),
    );
  }

  /* ── правая половина: что о категории вывел прибор ── */
  const branch = subtree(nodes, folder.id);
  const inBranch = nodes.filter((node) => node.id !== folder.id && branch.has(node.id));
  const branchRecords = inBranch.filter((node) => node.kind === "record" && node.slug);
  const events = chronology.events
    .filter((event) => branchRecords.some((node) => node.slug === event.slug))
    .slice(0, 6);
  const tags = countTags(branchRecords).slice(0, 14);
  const sealed = branchRecords.filter((node) => node.access > 0).length;
  const touched = branchRecords
    .map((node) => node.updatedAt)
    .sort()
    .at(-1);

  const rail = el("aside", { class: "rail-col" }, [
    panel(
      "Сводка",
      kv([
        ["записей", String(branchRecords.length)],
        ["подразделов", String(inBranch.filter((node) => node.kind === "folder").length)],
        ...(sealed > 0
          ? ([["под грифом", el("span", { style: "color:var(--red)" }, [String(sealed)])]] as const)
          : []),
        ...(events.length > 0
          ? ([["события", `${events[0]!.at.slice(0, 4)}—${events.at(-1)!.at.slice(0, 4)}`]] as const)
          : []),
        ["обновлено", touched ? when(touched) : "—"],
      ]),
    ),
  ]);

  if (events.length > 0) rail.append(panel("События раздела", eventList(events)));
  if (tags.length > 0) rail.append(panel("Метки раздела", chipRow(tags)));

  const neighbours = nodes
    .filter((node) => node.kind === "folder" && node.parentId === folder.parentId && node.id !== folder.id)
    .sort((a, b) => a.order - b.order);
  if (neighbours.length > 0) {
    rail.append(
      panel(
        folder.parentId ? "Рядом в разделе" : "Другие категории",
        kv(
          neighbours.map(
            (node) =>
              [
                link(`/folder/${node.id}`, node.name),
                String(nodes.filter((child) => child.parentId === node.id).length),
              ] as const,
          ),
        ),
      ),
    );
  }

  page.append(el("div", { class: "split" }, [main, rail]));

  view.replaceChildren(grid(false), strip, page);
  setFootCount(cover ? "титульный лист" : "");
  document.title = `${folder.name} — AETHER.WIKI`;
}

/* ── метка ─────────────────────────────────────────────────────────────── */

/**
 * Записи одной метки.
 *
 * Метка живёт поперёк дерева, поэтому здесь нет ни обложки, ни оглавления —
 * только список того, что метку несёт, с указанием, откуда каждая запись.
 */
export async function renderTag(view: HTMLElement, tag: string): Promise<void> {
  const { nodes } = await nav();
  const found = nodes
    .filter((node) => node.kind === "record" && node.slug && node.tags.includes(tag))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const strip = el("div", { class: "strip" }, [
    el("span", { class: "chrome" }, [link("/", "архив"), el("s", {}, ["/"]), "метки", el("s", {}, ["/"]), el("span", { class: "chrome--on" }, [tag])]),
    el("span", { class: "chrome sp" }, [plural(found.length, RECORDS)]),
  ]);

  const page = el("div", { class: "page" }, [
    el("div", { class: "hero hero--cat" }, [el("h1", {}, [`#${tag}`])]),
  ]);

  if (found.length === 0) {
    page.append(
      el("div", { class: "empty" }, [
        el("b", {}, ["метка не используется"]),
        el("span", {}, ["Ни одна запись её не несёт."]),
      ]),
    );
  } else {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const main = el("div", { class: "col" }, [
      sectionHead("Записи", plural(found.length, RECORDS)),
      recordIndex(found, {
        origin: (node) => byId.get(node.parentId ?? "")?.name ?? "вне категорий",
      }),
    ]);

    // Метка живёт поперёк дерева, поэтому справа — не «что рядом», а «где
    // встречается» и «с чем ходит вместе».
    const places = new Map<string, number>();
    for (const node of found) {
      const where = byId.get(node.parentId ?? "")?.name ?? "вне категорий";
      places.set(where, (places.get(where) ?? 0) + 1);
    }
    const near = countTags(found).filter(([name]) => name !== tag).slice(0, 12);

    const rail = el("aside", { class: "rail-col" }, [
      panel(
        "Где встречается",
        kv([...places.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => [name, String(n)] as const)),
      ),
    ]);
    if (near.length > 0) rail.append(panel("Смежные метки", chipRow(near)));

    page.append(el("div", { class: "split" }, [main, rail]));
  }

  view.replaceChildren(grid(false), strip, page);
  setFootCount(plural(found.length, RECORDS));
  document.title = `#${tag} — AETHER.WIKI`;
}

/* ── главная ───────────────────────────────────────────────────────────── */

export async function renderHome(view: HTMLElement): Promise<void> {
  const [{ nodes }, stats, chronology] = await Promise.all([
    nav(true),
    overview(),
    timeline().catch(() => ({ epochs: [], events: [] })),
  ]);

  const records = nodes.filter((node) => node.kind === "record" && node.slug);
  const tags = countTags(records);

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

  // Счётчики стоят полосой во всю ширину кадра: это приборная шкала архива,
  // а не украшение под заголовком.
  const gauge = (label: string, value: string, note: string, amber = false): HTMLElement =>
    el("div", { class: "gauge__cell" }, [
      el("span", { class: "chrome" }, [label]),
      el("b", { class: amber ? "is-amber" : "" }, [value]),
      el("s", {}, [note]),
    ]);

  const epochs = chronology.epochs.length;
  const gauges = el("div", { class: "gauge" }, [
    gauge("записей", String(stats.records), "в открытой части"),
    gauge("категорий", String(stats.folders), "включая вложенные"),
    gauge("под грифом", String(stats.restricted), "требуют допуска", stats.restricted > 0),
    gauge("событий", String(chronology.events.length), epochs > 0 ? plural(epochs, ["эпоха", "эпохи", "эпох"]) : "хронология пуста"),
    gauge("меток", String(tags.length), "поперёк дерева"),
  ]);

  const page = el("div", { class: "page" }, [
    el("div", { class: "hero" }, [
      el("h1", {}, ["ECLIPSE ", el("em", {}, ["PROTOCOL"])]),
      el("p", {}, [
        "Летопись протокола: люди, операции, места и то, что от них осталось в открытой части архива.",
      ]),
      search,
    ]),
    gauges,
  ]);

  const cards = folderCards(nodes, null);
  if (cards) page.append(sectionHead("Категории", `${stats.folders}`), cards);

  const loose = childRecords(nodes, null);
  if (loose.length > 0) page.append(sectionHead("Вне категорий"), recordIndex(loose));

  const bySlug = new Map(records.map((node) => [node.slug!, node]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const feed = el(
    "div",
    { class: "feed" },
    stats.recent.map((entry) => {
      const node = bySlug.get(entry.slug);
      const where = node ? byId.get(node.parentId ?? "")?.name : undefined;
      const row = link(`/wiki/${entry.slug}`, "");
      row.append(
        el("time", {}, [when(entry.updatedAt)]),
        el("b", {}, [entry.title]),
        el("span", { class: "og" }, [where ?? "вне категорий"]),
        el("s", { class: entry.restricted ? "chrome--red" : "" }, [
          entry.restricted ? "под грифом" : "",
        ]),
      );
      return row;
    }),
  );

  const toTimeline = link("/timeline", "");
  toTimeline.append(
    el("em", {}, ["↗"]),
    el("b", {}, ["Хронология"]),
    el("s", {}, ["Летопись протокола от первого события до сегодняшнего дня."]),
  );

  const gates = el("div", { class: "gate" }, [
    toTimeline,
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

  const middle = el("div", {}, [sectionHead("Метки", String(tags.length))]);
  middle.append(
    tags.length > 0
      ? chipRow(tags.slice(0, 40))
      : el("div", { class: "empty" }, [
          el("b", {}, ["меток нет"]),
          el("span", {}, ["Метки проставляются записи в админке."]),
        ]),
  );
  if (chronology.events.length > 0) {
    // Хронология отдана по возрастанию; на главной интересен её конец.
    middle.append(
      sectionHead("Последние события"),
      eventList(chronology.events.slice(-5).reverse()),
    );
  }

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
      middle,
      el("div", {}, [sectionHead("Другие входы"), gates]),
    ]),
  );

  view.replaceChildren(grid(false), strip, page);
  setFootCount(plural(stats.records, RECORDS));
  document.title = "AETHER.WIKI";
}
