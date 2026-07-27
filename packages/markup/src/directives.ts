/**
 * Widget vocabulary for wiki records.
 *
 * Every widget is a markdown *directive* rather than bespoke syntax:
 *
 *   inline   :tag[Пропал без вести]{style=warn}
 *   leaf     ::image{src=/media/kremen.jpg caption="Последнее фото"}
 *   block    :::infobox ... :::
 *
 * Using the directive syntax instead of a hand-rolled parser is what buys
 * escaping, nesting, quoted attributes and a standard AST for free. The old
 * wiki's parser had none of those: a comma inside a table cell split the row,
 * and a widget could not contain another widget.
 *
 * A directive whose name is not in this table is deliberately *not* an error.
 * Public rendering leaves it as plain text so one typo cannot blank a page;
 * the editor surfaces it as a warning instead (see `renderMarkup().unknown`).
 */

import type { Element, ElementContent, Properties } from "hast";

export type DirectiveKind = "textDirective" | "leafDirective" | "containerDirective";

/** What a record looks like from outside, for widgets that link to one. */
export interface RecordFacts {
  title: string;
  /** Folder the record sits in, shown under the title. */
  category?: string;
  access?: number;
}

/**
 * Everything a widget may need beyond its own text.
 *
 * Kept as one object rather than growing the argument list: a widget that
 * resolves a record and a widget that does not should read the same way.
 */
export interface DirectiveEnv {
  resolveRecord?: (slug: string) => RecordFacts | null;
  linkBase?: string;
}

export interface DirectiveContext {
  name: string;
  kind: DirectiveKind;
  attributes: Record<string, string>;
  /** Already-converted children, for inline and container directives. */
  children: ElementContent[];
  /** Raw text of the directive label, useful for widgets that ignore markup. */
  text: string;
  env: DirectiveEnv;
}

export interface DirectiveSpec {
  kinds: DirectiveKind[];
  render: (context: DirectiveContext) => Element;
}

const el = (
  tagName: string,
  properties: Properties,
  children: ElementContent[] = [],
): Element => ({ type: "element", tagName, properties, children });

const text = (value: string): ElementContent => ({ type: "text", value });

/** Attribute lookup with a fallback, so a missing value never renders "undefined". */
const attr = (context: DirectiveContext, name: string, fallback = ""): string =>
  context.attributes[name] ?? fallback;

const numeric = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Style keyword -> class suffix. Anything unrecognised falls back to neutral. */
const STYLES = new Set(["neutral", "info", "ok", "warn", "danger", "ghost"]);

/** Заголовок врезки по умолчанию — чтобы `:::note{style=warn}` уже был осмыслен. */
const DEFAULT_NOTE_TITLES: Record<string, string> = {
  neutral: "примечание",
  info: "справка",
  ok: "подтверждено",
  warn: "внимание",
  danger: "оспорено",
  ghost: "примечание",
};

/** Готовые схемы титульного листа: фон + второй цвет. */
const COVER_THEMES = new Set([
  "black-red",
  "black-white",
  "black-blue",
  "red-black",
  "red-white",
  "blue-white",
  "blue-black",
  "orange-white",
  "orange-black",
]);

const COVER_PATTERNS = new Set(["fiber", "grid", "hatch", "rays", "none"]);
const styleClass = (value: string): string =>
  STYLES.has(value) ? `is-${value}` : "is-neutral";

export const DIRECTIVES: Record<string, DirectiveSpec> = {
  /** Small status pill: `:tag[Мёртв, официально]{style=danger}` */
  tag: {
    kinds: ["textDirective"],
    render: (c) =>
      el("span", { className: ["w-tag", styleClass(attr(c, "style", "neutral"))] }, c.children),
  },

  /** Hidden until clicked. Kept for parity with the old `||spoiler||`. */
  spoiler: {
    kinds: ["textDirective"],
    render: (c) => el("span", { className: ["w-spoiler"], tabIndex: 0 }, c.children),
  },

  /**
   * Redacted below a clearance level: `:classified[отчёт 12-B]{level=3}`.
   *
   * The element rendered here is the *already permitted* form. Deciding what a
   * given reader may see is not a rendering concern - it happens before this,
   * on the server, by rewriting the AST. Doing it in CSS would ship the secret
   * to the browser and call it hidden.
   */
  classified: {
    kinds: ["textDirective", "containerDirective"],
    render: (c) =>
      el(
        c.kind === "containerDirective" ? "div" : "span",
        { className: ["w-classified"], dataLevel: attr(c, "level", "1") },
        c.children,
      ),
  },

  /** Labelled progress bar: `::bar{name=Готовность max=10 current=7}` */
  bar: {
    kinds: ["leafDirective", "textDirective"],
    render: (c) => {
      const max = numeric(attr(c, "max"), 100);
      const current = numeric(attr(c, "current"), 0);
      const ratio = max > 0 ? Math.min(Math.max(current / max, 0), 1) : 0;
      return el("span", { className: ["w-bar"], dataRatio: ratio.toFixed(3) }, [
        el("span", { className: ["w-bar-label"] }, [text(attr(c, "name"))]),
        el("span", { className: ["w-bar-track"] }, [
          el("span", { className: ["w-bar-fill"], style: `width:${(ratio * 100).toFixed(1)}%` }),
        ]),
        el("span", { className: ["w-bar-value"] }, [text(`${current}/${max}`)]),
      ]);
    },
  },

  /** Discrete version of the same thing, for small counts. */
  dotbar: {
    kinds: ["leafDirective", "textDirective"],
    render: (c) => {
      const max = Math.min(Math.max(Math.round(numeric(attr(c, "max"), 5)), 0), 50);
      const current = Math.min(Math.max(Math.round(numeric(attr(c, "current"), 0)), 0), max);
      const dots: ElementContent[] = [];
      for (let i = 0; i < max; i++) {
        dots.push(el("span", { className: ["w-dot", i < current ? "is-on" : "is-off"] }));
      }
      return el("span", { className: ["w-dotbar"] }, [
        el("span", { className: ["w-bar-label"] }, [text(attr(c, "name"))]),
        el("span", { className: ["w-dots"] }, dots),
      ]);
    },
  },

  /** In-world date. Rendering of the value itself is left to the client. */
  timestamp: {
    kinds: ["textDirective", "leafDirective"],
    render: (c) =>
      el("time", { className: ["w-timestamp"], dateTime: attr(c, "at") }, [
        text(c.text || attr(c, "at")),
      ]),
  },

  countdown: {
    kinds: ["textDirective", "leafDirective"],
    render: (c) =>
      el("span", { className: ["w-countdown"], dataUntil: attr(c, "until") }, [
        text(c.text || attr(c, "until")),
      ]),
  },

  /** `::image{src=... caption=... align=right}` */
  image: {
    kinds: ["leafDirective"],
    render: (c) => {
      const caption = attr(c, "caption");
      const children: ElementContent[] = [
        el("img", { src: attr(c, "src"), alt: attr(c, "alt", caption), loading: "lazy" }),
      ];
      if (caption) children.push(el("figcaption", {}, [text(caption)]));
      return el(
        "figure",
        { className: ["w-image", `is-${attr(c, "align", "full")}`] },
        children,
      );
    },
  },

  /**
   * `:::quote{author=Кремень date=2031.04.02}` with markdown inside.
   *
   * `by=` — то же самое: заготовка в палитре админки всегда предлагала именно
   * его, и подпись под цитатой молча пропадала. Читается и то и другое, потому
   * что записи с `by=` уже написаны.
   */
  quote: {
    kinds: ["containerDirective"],
    render: (c) => {
      const author = attr(c, "author") || attr(c, "by");
      const date = attr(c, "date");
      const children = [...c.children];
      if (author || date) {
        children.push(
          el("figcaption", { className: ["w-quote-by"] }, [
            text([author, date].filter(Boolean).join(" · ")),
          ]),
        );
      }
      return el("figure", { className: ["w-quote"] }, children);
    },
  },

  /**
   * The side panel. Not a separate field on the record - just a named block, so
   * a page can have two of them, or one halfway down, with no schema change.
   */
  infobox: {
    kinds: ["containerDirective"],
    render: (c) => {
      const children: ElementContent[] = [];
      const title = attr(c, "title");
      if (title) children.push(el("div", { className: ["w-infobox-title"] }, [text(title)]));
      children.push(...c.children);
      return el("aside", { className: ["w-infobox"], dataSlot: "aside" }, children);
    },
  },

  /** Map embed: a viewport onto a named map, optionally at a timeline date. */
  map: {
    kinds: ["leafDirective"],
    render: (c) =>
      el("div", {
        className: ["w-map"],
        dataMap: attr(c, "id", "world"),
        dataLng: attr(c, "lng", "0"),
        dataLat: attr(c, "lat", "0"),
        dataZoom: attr(c, "zoom", "4"),
        dataAt: attr(c, "at"),
      }),
  },

  /** Auto-filled country summary, resolved from map data at render time. */
  "country-stats": {
    kinds: ["leafDirective"],
    render: (c) =>
      el("div", { className: ["w-country-stats"], dataCountry: attr(c, "tag") }),
  },

  gallery: {
    kinds: ["containerDirective"],
    render: (c) => el("div", { className: ["w-gallery"] }, c.children),
  },

  /* ─── врезки, таблицы, вложения ───────────────────────────────────────
     Всё, что ниже, появилось после того, как оформление разошлось с тем,
     что разметка умела выразить: редакторы писали врезки абзацами с жирным
     словом в начале, а ссылку на другую запись — обычной строкой. */

  /** `:::note{style=warn title="Расхождение"}` — редакторское примечание. */
  note: {
    kinds: ["containerDirective"],
    render: (c) => {
      const children: ElementContent[] = [];
      const title = attr(c, "title") || DEFAULT_NOTE_TITLES[attr(c, "style", "neutral")] || "примечание";
      children.push(el("b", {}, [text(title)]));
      children.push(...c.children);
      return el("div", { className: ["w-note", styleClass(attr(c, "style", "neutral"))] }, children);
    },
  },

  /**
   * `::video{src=… poster=… caption=…}`
   *
   * Настоящий <video>, а не картинка с треугольником: подделка кадра выглядит
   * так же, но не играет, и читатель узнаёт об этом только щёлкнув.
   */
  video: {
    kinds: ["leafDirective"],
    render: (c) => {
      const caption = attr(c, "caption");
      const children: ElementContent[] = [
        el("video", {
          className: ["w-video__frame"],
          src: attr(c, "src"),
          poster: attr(c, "poster") || undefined,
          controls: true,
          preload: "metadata",
        }),
      ];
      if (caption) children.push(el("figcaption", {}, [text(caption)]));
      return el("figure", { className: ["w-video"] }, children);
    },
  },

  /**
   * `:::table{caption="Состав группы"}` вокруг обычной таблицы markdown.
   *
   * Директива не разбирает таблицу — её уже разобрал GFM. Она добавляет
   * подпись и класс, потому что на бумаге таблице нужен свой вид.
   */
  table: {
    kinds: ["containerDirective"],
    render: (c) => {
      for (const child of c.children) {
        if (child.type === "element" && child.tagName === "table") {
          child.properties = { ...child.properties, className: ["w-table"] };
        }
      }
      const children = [...c.children];
      const caption = attr(c, "caption");
      if (caption) children.push(el("figcaption", { className: ["w-table-cap"] }, [text(caption)]));
      return el("figure", { className: ["w-table-wrap"] }, children);
    },
  },

  /**
   * `::record{slug=protokol-apollon}` — ссылка на запись как на объект.
   *
   * Название и категорию подставляет сервер, поэтому переименование записи
   * не оставляет в чужом тексте старое имя.
   */
  record: {
    kinds: ["leafDirective", "textDirective"],
    render: (c) => {
      const slug = attr(c, "slug") || c.text.trim();
      const facts = c.env.resolveRecord?.(slug) ?? null;
      const base = c.env.linkBase ?? "/wiki/";
      if (!facts) {
        return el("span", { className: ["w-record", "is-broken"], dataBroken: "true" }, [
          text(slug),
        ]);
      }
      const sealed = (facts.access ?? 0) > 0;
      return el("a", { className: ["w-record"], href: `${base}${slug}` }, [
        el("i", {}, [text(sealed ? "◇" : "◆")]),
        el("span", {}, [
          el("b", {}, [text(facts.title)]),
          el("s", {}, [
            text(
              [facts.category, sealed ? `требуется допуск ${facts.access}` : null]
                .filter(Boolean)
                .join(" · "),
            ),
          ]),
        ]),
        el("em", {}, [text(slug)]),
      ]);
    },
  },

  /** `::file{src=… name="Отчёт 12-Б" size="240 КБ"}` — вложение. */
  file: {
    kinds: ["leafDirective"],
    render: (c) =>
      el("a", { className: ["w-file"], href: attr(c, "src"), download: true }, [
        el("span", {}, [text("▣")]),
        el("span", {}, [text(attr(c, "name") || attr(c, "src"))]),
        el("em", {}, [text(attr(c, "size"))]),
      ]),
  },

  /**
   * `:::fields` — пары «ключ :: значение», по одной на строку.
   *
   * Разбирается по сырому тексту, а не по разметке: строки внутри одного
   * абзаца markdown склеивает мягкими переносами, и дерево здесь ничего
   * не добавляет, кроме работы.
   */
  fields: {
    kinds: ["containerDirective"],
    render: (c) => {
      const rows: ElementContent[] = [];
      for (const line of c.text.split(/\r?\n/)) {
        const at = line.indexOf("::");
        if (at < 0) continue;
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 2).trim();
        if (!key) continue;
        rows.push(el("dt", {}, [text(key)]), el("dd", {}, [text(value)]));
      }
      return el("dl", { className: ["w-fields"] }, rows);
    },
  },

  /**
   * `::event{at=2022-07-11 epoch="Разлом"}` — запись в летописи.
   *
   * Ставит на странице датированную строку и одновременно объявляет, что эта
   * запись — событие хронологии. Отдельного хранилища у ленты нет намеренно:
   * событие живёт в той же записи, что и рассказ о нём, и не может
   * разойтись с ней.
   */
  /**
   * Отметка о времени со ссылкой в летопись.
   *
   * Раньше именно она заводила запись в хронологию, и дата жила в теле текста
   * — то есть в том месте, которое правят чаще всего. Теперь дата события
   * лежит в свойствах записи, а эта отметка только показывает её в тексте и
   * ведёт на общую ленту. Разошлись они уже не могут: показывать нечего,
   * кроме того, что автор здесь и написал.
   */
  event: {
    kinds: ["leafDirective", "textDirective"],
    render: (c) => {
      const at = attr(c, "at");
      const epoch = attr(c, "epoch");
      const base = c.env.linkBase ?? "/wiki/";
      return el(
        "a",
        {
          className: ["w-event"],
          href: base.replace(/wiki\/?$/, "timeline"),
          dataAt: at,
          dataEpoch: epoch,
        },
        [
          el("time", { className: ["w-event__at"], dateTime: at }, [text(at)]),
          el("span", { className: ["w-event__epoch"] }, [text(epoch)]),
          el("span", { className: ["w-event__go"] }, [text("в хронологию ↗")]),
        ],
      );
    },
  },

  /** `:::center` и `:::right` — выравнивание блока. */
  center: {
    kinds: ["containerDirective"],
    render: (c) => el("div", { className: ["w-center"] }, c.children),
  },

  /* ─── титульный лист категории ────────────────────────────────────────
     Обложка — обычная запись с именем `_cover` внутри папки. Оболочка ниже
     раскладывает то, что автор написал сверху вниз, на титульный лист:
     всё, кроме нижних колонок, попадает в центральную часть.

     Важно про вложенность: у markdown-директив внешний контейнер должен
     иметь БОЛЬШЕ двоеточий, чем внутренний. Одинаковая ширина забора
     закрывает внешний контейнер вместо того, чтобы вложить внутренний, и
     титул рассыпается на куски. Поэтому лист пишется так:

       ::::::cover{…}
       # Название
       :::::epigraph{…} … :::::
       :::::columns
         ::::right
           :::fields … :::
           ::stamp[…]
         ::::
       :::::
       :::::: */

  cover: {
    kinds: ["containerDirective"],
    render: (c) => {
      const theme = attr(c, "theme");
      const pattern = attr(c, "pattern", "fiber");
      const classes = ["cover"];
      if (COVER_THEMES.has(theme)) classes.push(`cover--${theme}`);
      if (COVER_PATTERNS.has(pattern)) classes.push(`cover--pat-${pattern}`);

      const logo = attr(c, "logo");
      const mark = logo
        ? el("div", { className: ["cover__mark", "cover__mark--img"] }, [
            el("img", { src: logo, alt: attr(c, "org") || "" }),
          ])
        : el("div", { className: ["cover__mark"] }, [text(attr(c, "mark", "◆"))]);

      const head: ElementContent[] = [mark];
      const org = attr(c, "org");
      if (org) head.push(el("div", { className: ["cover__org"] }, [text(org)]));
      const volume = attr(c, "volume");
      if (volume) head.push(el("div", { className: ["cover__vol"] }, [text(volume)]));

      // Заголовок и эпиграф стоят по центру, нижние колонки — под линией.
      const middle: ElementContent[] = [];
      const foot: ElementContent[] = [];
      for (const child of c.children) {
        const cls =
          child.type === "element" && Array.isArray(child.properties?.className)
            ? (child.properties.className as string[])
            : [];
        if (cls.includes("cover__foot")) foot.push(child);
        else middle.push(child);
      }
      // Черта под названием рисуется здесь, а не автором: она часть листа.
      const titleAt = middle.findIndex(
        (child) => child.type === "element" && child.tagName === "h1",
      );
      if (titleAt >= 0) middle.splice(titleAt + 1, 0, el("div", { className: ["cover__rule"] }));

      return el("article", { className: classes }, [
        el("div", { className: ["cover__frame"] }),
        el("div", { className: ["cover__in"] }, [...head, ...middle]),
        ...foot,
      ]);
    },
  },

  epigraph: {
    kinds: ["containerDirective"],
    render: (c) => {
      const children = [...c.children];
      const cite = attr(c, "cite");
      if (cite) children.push(el("cite", {}, [text(cite)]));
      return el("blockquote", { className: ["cover__epi"] }, children);
    },
  },

  columns: {
    kinds: ["containerDirective"],
    render: (c) => el("div", { className: ["cover__foot"] }, c.children),
  },

  right: {
    kinds: ["containerDirective"],
    render: (c) => el("div", { className: ["cover__imprint"] }, c.children),
  },

  /**
   * Штамп.
   *
   * Раньше жил только на титульном листе и был там обводкой с наклоном —
   * этого хватало, потому что рядом стояли выходные сведения и лист сам
   * объяснял, что это оттиск. В теле записи та же обводка читалась просто
   * наклонённым текстом: ни второй линии, ни неровности краски, ничего, что
   * отличает штамп от рамки.
   *
   * Поэтому здесь теперь настоящий оттиск, и он несёт то, что несёт настоящий:
   * слово, а под ним дату и того, кто ставил. Обе строки необязательны, и без
   * них штамп остаётся однострочным — как на титуле.
   *
   *   ::stamp[для служебного пользования]{tone=red date=12.04.2031 by="Архив"}
   */
  stamp: {
    kinds: ["textDirective", "leafDirective"],
    render: (c) => {
      const tone = attr(c, "tone", "red");
      const classes = ["w-stamp"];
      if (STAMP_TONES.has(tone)) classes.push(`w-stamp--${tone}`);

      const lines: ElementContent[] = [
        el("b", {}, [text(c.text || attr(c, "label", "штамп"))]),
      ];
      const foot = [attr(c, "date"), attr(c, "by")].filter(Boolean).join(" · ");
      if (foot) lines.push(el("s", {}, [text(foot)]));

      // Угол задаётся автором, но в пределах разумного: оттиск, повёрнутый на
      // сорок градусов, читается как ошибка вёрстки, а не как небрежность
      // руки. Значение приходит строкой из разметки — проверяется здесь.
      const wanted = Number(attr(c, "angle", "-6"));
      const angle = Number.isFinite(wanted) ? Math.max(-14, Math.min(14, wanted)) : -6;

      return el(
        "div",
        { className: classes, style: `--stamp-angle:${angle}deg` },
        [el("span", { className: ["w-stamp__in"] }, lines)],
      );
    },
  },
};

const STAMP_TONES = new Set(["red", "ink", "blue", "green"]);

export const KNOWN_DIRECTIVES = new Set(Object.keys(DIRECTIVES));
