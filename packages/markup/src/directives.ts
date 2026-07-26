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

export interface DirectiveContext {
  name: string;
  kind: DirectiveKind;
  attributes: Record<string, string>;
  /** Already-converted children, for inline and container directives. */
  children: ElementContent[];
  /** Raw text of the directive label, useful for widgets that ignore markup. */
  text: string;
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

  /** `:::quote{author=Кремень date=2031.04.02}` with markdown inside. */
  quote: {
    kinds: ["containerDirective"],
    render: (c) => {
      const author = attr(c, "author");
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
};

export const KNOWN_DIRECTIVES = new Set(Object.keys(DIRECTIVES));
