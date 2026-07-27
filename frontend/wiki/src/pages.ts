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
import { decode, revealArticle, revealOnEnter } from "./reveal.js";
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

/*
 * Волосяных вертикалей по полям кадра здесь больше нет.
 *
 * Они задумывались как поле — отметка того, где начинается и кончается
 * содержимое, — но во весь рост экрана линия читается не как поле, а как
 * обрез: страница оказывается запертой в рамку, а ярлыки и шапка — внутри
 * коробки. На странице записи их не было с самого начала ровно по этой
 * причине; теперь их нет нигде, потому что каталожные экраны — та же вики, и
 * два разных кадра на один архив означали бы, что читатель переходит между
 * разными сайтами.
 */

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

/**
 * Конец документа: переходы к соседям по категории.
 *
 * Раньше это была панель в колонке досье, и запись просто обрывалась — лист
 * кончался, а страница нет. Внизу же оно отвечает на вопрос, который у
 * читателя возникает ровно здесь: что дальше.
 */
function recordEnds(page: RecordPage): HTMLElement | null {
  const { prev, next } = page.siblings ?? { prev: null, next: null };
  if (!prev && !next) return null;

  const cell = (link_: { slug: string; title: string }, dir: "prev" | "next"): HTMLElement => {
    const cell_ = link(`/wiki/${link_.slug}`, "", dir === "next" ? "to-next" : "");
    cell_.append(
      el("span", { class: "dir" }, [dir === "prev" ? "← предыдущая" : "следующая →"]),
      el("b", {}, [link_.title]),
      el("s", {}, [link_.slug]),
    );
    return cell_;
  };

  const ends = el("nav", { class: `ends${prev && next ? "" : " ends--one"}` }, [
    prev ? cell(prev, "prev") : null,
    next ? cell(next, "next") : null,
  ]);
  return ends;
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
  // Полоса принадлежности, лист, переходы и досье — прямые ячейки сетки, а не
  // вложенная стопка: только так досье встаёт вровень с верхом документа, а не
  // с верхом полосы над ним.
  const row = el("div", { class: `body__in${aside ? "" : " body__in--bare"}` }, [
    el("nav", { class: "toc-slot" }),
    page.belongs ? belongBand(page.belongs) : null,
    article,
    recordEnds(page),
    aside,
  ]);

  view.replaceChildren(contextStrip(page), el("div", { class: "body" }, [row]));

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

  // Вывод документа идёт по всей строке, а не по одной бумаге: досье справа —
  // тоже авторский текст. Закрытая запись выводится так же: там плашки и есть
  // содержимое, и выезжают они в том же порядке, в каком читался бы текст.
  revealArticle(row);

  setFootCount(page.restricted ? "доступ ограничен" : "");
  document.title = `${page.node.name} — AETHER.WIKI`;
}

function renderMissing(view: HTMLElement, message: string): void {
  view.replaceChildren(
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

/**
 * Вывод приборной части экрана.
 *
 * Одна очередь на все каталожные страницы — главную, категорию и метку: они
 * собраны из одних и тех же частей, и три разных появления у одного ярлыка
 * означали бы, что читатель заново узнаёт знакомую вещь на каждом экране.
 *
 * Числа шкалы расшифровываются тем же прибором, что и текст записи. Счётчик,
 * который отсчитывает от нуля, показывал бы, как система считает; здесь она
 * не считает, а снимает готовое значение — поэтому цифры не растут, а
 * проступают.
 */
function animatePage(page: HTMLElement): void {
  // Наблюдение за ящиком целиком, а не за каждым ярлыком: ярлык выходит
  // из-под нижнего среза, а полностью срезанный элемент браузер считает
  // невидимым и о появлении в кадре не сообщает — он так и остался бы
  // спрятанным. Очередь внутри ящика задаёт стиль, по порядку ярлыков.
  revealOnEnter(page.querySelectorAll<HTMLElement>(".cards"));
  revealOnEnter(page.querySelectorAll<HTMLElement>(".entries tr"), { stagger: 70, cap: 14 });
  revealOnEnter(page.querySelectorAll<HTMLElement>(".rail-col .panel"), { stagger: 140, cap: 4 });
  revealOnEnter(page.querySelectorAll<HTMLElement>(".mini__row"), { stagger: 80, cap: 8 });
  revealOnEnter(page.querySelectorAll<HTMLElement>(".chips .chip"), { stagger: 26, cap: 26 });

  const dials = [...page.querySelectorAll<HTMLElement>(".is-dial")];
  for (const [i, dial] of dials.entries()) decode(dial, 320 + i * 130);
}

function sectionHead(title: string, note?: string): HTMLElement {
  return el("div", { class: "page__head" }, [
    el("h2", {}, [title]),
    note ? el("s", { class: "chrome" }, [note]) : null,
  ]);
}

/** Число записей во всей ветке раздела, не только среди прямых детей. */
function folderWeight(nodes: NavNode[], folderId: string): number {
  const ids = subtree(nodes, folderId);
  return nodes.filter((node) => ids.has(node.id) && node.kind === "record" && node.slug).length;
}

/**
 * Ярлыки категорий.
 *
 * Карточка несёт описание раздела, если оно задано, и код — штамп картотеки
 * вроде [PERS], если его завели в админке. До описания у категории снаружи
 * было только название, и выбор между «Организациями» и «Технологиями»
 * читатель делал, угадывая по слову — а угадывать в архиве как раз и не
 * должен: он для того и открыт, чтобы не гадать.
 *
 * Размер карточки — вес раздела в записях, не украшение: там, где архива
 * много, блок крупный (`--lg`), где среднее — широкий (`--wide`), а тесная
 * сетка подразделов (`tight`) размеры не разносит вовсе — это не витрина
 * входа в архив, а список внутри уже открытой категории.
 *
 * Порог считается от среднего веса, а не от максимума: доля максимума даёт
 * крупный блок каждой категории, если все разделы примерно одного размера, —
 * а смысл в укрупнении есть только там, где раздел заметно больше соседей.
 * Если архив растёт ровно, ряд карточек и должен остаться рядом равных.
 */
function folderCards(nodes: NavNode[], parentId: string | null, tight = false): HTMLElement | null {
  const folders = nodes
    .filter((node) => node.parentId === parentId && node.kind === "folder")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  if (folders.length === 0) return null;

  const weights = new Map(folders.map((folder) => [folder.id, folderWeight(nodes, folder.id)] as const));
  const nonZero = [...weights.values()].filter((weight) => weight > 0);
  const mean = nonZero.length > 0 ? nonZero.reduce((sum, weight) => sum + weight, 0) / nonZero.length : 0;
  const tierOf = (weight: number): "lg" | "wide" | "" => {
    if (tight || weight === 0 || mean === 0) return "";
    if (weight >= mean * 1.5) return "lg";
    if (weight >= mean * 1.1) return "wide";
    return "";
  };

  return el(
    "div",
    { class: `cards${tight ? " cards--tight" : " cards--bento"}` },
    folders.map((folder) => {
      const weight = weights.get(folder.id) ?? 0;
      const tier = tierOf(weight);
      const sealed = folder.access > 0;
      const card = link(
        `/folder/${folder.id}`,
        "",
        `folder${sealed ? " folder--sealed" : ""}${tier ? ` folder--${tier}` : ""}`,
      );
      if (folder.code) card.append(el("span", { class: "folder__code" }, [folder.code]));
      card.append(el("b", {}, [folder.name]));
      if (folder.summary) card.append(el("p", {}, [folder.summary]));
      card.append(
        el("s", {}, [
          sealed
            ? `требуется допуск ${folder.access}`
            : weight === 0
              ? el("span", { class: "folder__redacted" }, ["[ ЗАСЕКРЕЧЕНО ]"])
              : plural(weight, RECORDS),
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
    // Без титульного листа описание раздела — единственное, что объясняет
    // категорию словами, поэтому стоит прямо под названием.
    page.append(
      el("div", { class: "hero hero--cat" }, [
        el("h1", {}, [folder.name]),
        folder.summary ? el("p", {}, [folder.summary]) : null,
      ]),
    );
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

  view.replaceChildren(strip, page);
  // Титульный лист — тот же документ, и разбирается так же: эпиграф проступает
  // из шума, штамп падает сверху.
  const slot = page.querySelector<HTMLElement>(".cover-slot");
  if (slot) revealArticle(slot);
  animatePage(page);
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

  view.replaceChildren(strip, page);
  animatePage(page);
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

  const page = el("div", { class: "page" }, [
    el("div", { class: "hero" }, [
      el("h1", {}, ["ECLIPSE ", el("em", {}, ["PROTOCOL"])]),
      el("p", {}, [
        "Летопись протокола: люди, операции, места и то, что от них осталось в открытой части архива.",
      ]),
      search,
    ]),
  ]);

  /* ── левая половина: чем архив открывается ── */
  const main = el("div", { class: "col" });

  const cards = folderCards(nodes, null);
  if (cards) main.append(sectionHead("Категории", `${stats.folders}`), cards);

  const loose = childRecords(nodes, null);
  if (loose.length > 0) main.append(sectionHead("Вне категорий"), recordIndex(loose));

  main.append(
    sectionHead("Метки", String(tags.length)),
    tags.length > 0
      ? chipRow(tags.slice(0, 40))
      : el("div", { class: "empty" }, [
          el("b", {}, ["меток нет"]),
          el("span", {}, ["Метки проставляются записи в админке."]),
        ]),
  );

  /*
   * ── правая колонка: то, что раньше было полосой шкалы во всю ширину ──
   *
   * Пять цифр архива не заслуживали отдельной полосы во весь кадр — это
   * ровно то же, что «Сводка» на странице категории, просто для архива
   * целиком, и ей место там же: в плотном приборном виджете сбоку, а не в
   * витрине под заголовком.
   *
   * «Свежих правок» в этой колонке нет вовсе — она была здесь раньше в
   * других видах (самой широкой колонкой, потом узкой панелью) и ни разу не
   * отвечала на вопрос, с которым приходят на главную: список показывает,
   * что трогал редактор, а не сам архив. Последние события — другое: это
   * конец хронологии, то есть содержание, а не журнал работы над ним.
   */
  const epochs = chronology.epochs.length;
  const overviewPanel = panel(
    "Обзор архива",
    kv([
      ["записей", String(stats.records)],
      ["категорий", String(stats.folders)],
      ...(stats.restricted > 0
        ? ([["под грифом", el("span", { style: "color:var(--red)" }, [String(stats.restricted)])]] as const)
        : []),
      ["событий", String(chronology.events.length)],
      ...(epochs > 0 ? ([["эпох", String(epochs)]] as const) : []),
      ["меток", String(tags.length)],
      ["обновлено", stats.recent[0] ? when(stats.recent[0].updatedAt) : "—"],
    ]),
  );
  // Цифры сводки печатаются тем же прибором, что и текст записи: дата и слово
  // «сегодня» — обычная строка документа, а не показание счётчика.
  for (const dd of overviewPanel.querySelectorAll<HTMLElement>("dd")) {
    if (/^\d+$/.test(dd.textContent ?? "")) dd.classList.add("is-dial");
  }
  const rail = el("aside", { class: "rail-col" }, [overviewPanel]);

  if (chronology.events.length > 0) {
    // Хронология отдана по возрастанию; на главной интересен её конец.
    rail.append(
      panel(
        "Последние события",
        el("div", {}, [eventList(chronology.events.slice(-6).reverse()), link("/timeline", "вся летопись", "more-link")]),
      ),
    );
  }

  page.append(el("div", { class: "split" }, [main, rail]));

  view.replaceChildren(strip, page);
  animatePage(page);
  setFootCount(plural(stats.records, RECORDS));
  document.title = "AETHER.WIKI";
}
