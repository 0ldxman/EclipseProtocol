/**
 * Wiki markup: GitHub-flavoured markdown + directives + `[[wiki links]]`.
 *
 * One implementation, on the server, is the canonical one. The server needs the
 * parsed form anyway - for the link graph, the search index, excerpts and for
 * redacting content the reader is not cleared for - and a second parser in the
 * browser would be a second set of bugs. The editor previews by asking this.
 *
 * Output is sanitised HTML plus the derived facts a record page needs:
 * outgoing links, headings for a table of contents, a plain-text excerpt, the
 * first image, and any directive names that were not recognised.
 */

import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { toHtml } from "hast-util-to-html";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { Element, Root as HastRoot } from "hast";
import { DIRECTIVES, KNOWN_DIRECTIVES } from "./directives.js";
import { directiveHandlers, remarkUnknownDirectives, type WidgetReport } from "./widgets.js";
import { remarkWikiLinks, type LinkReport } from "./wikilinks.js";
import { collectHeadings, excerptOf, firstImage, type Heading } from "./derive.js";

export interface RenderResult {
  html: string;
  /** Slugs this record links to, deduplicated, in document order. */
  links: string[];
  /** Links whose target could not be resolved, when a resolver was supplied. */
  brokenLinks: string[];
  headings: Heading[];
  excerpt: string;
  firstImage: string | null;
  /** Directive names that are not part of the vocabulary. */
  unknown: string[];
  /**
   * Infobox blocks lifted out of the body, in document order, when
   * `extractInfoboxes` was asked for. Empty otherwise, and the infoboxes are
   * then left where the author put them.
   */
  infoboxes: string[];
}

export interface RenderOptions {
  /**
   * Decides whether a link target exists. Used only to report broken links -
   * an unresolved link still renders, marked, rather than disappearing.
   */
  linkExists?: (slug: string) => boolean;
  /** Prefix for record URLs; defaults to "/wiki/". */
  linkBase?: string;
  /**
   * Return infobox blocks separately instead of leaving them in the body.
   *
   * The record page puts the infobox in its own column beside the article, but
   * an infobox is deliberately not a database field - it is a block the author
   * wrote somewhere in the document. Lifting it out at render time keeps both
   * facts true: one document, two columns.
   */
  extractInfoboxes?: boolean;
}

/**
 * Sanitiser schema.
 *
 * Records are written by trusted editors, but "trusted" is not "infallible",
 * and pasted content is a normal way to write a wiki page. Rather than allow
 * arbitrary HTML, the widget classes and data attributes this renderer emits
 * are added to the default safe schema, and everything else is stripped.
 */
const schema = {
  ...defaultSchema,
  // rehype-sanitize prefixes id/name with "user-content-" by default to stop
  // pages clobbering each other's anchors. There is one document per page here,
  // so the prefix only breaks the table-of-contents links.
  clobberPrefix: "",
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "aside",
    "figure",
    "figcaption",
    "time",
    "span",
    "div",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "dataLevel",
      "dataRatio",
      "dataSlot",
      "dataMap",
      "dataLng",
      "dataLat",
      "dataZoom",
      "dataAt",
      "dataUntil",
      "dataCountry",
      "dataBroken",
      "id",
      "style",
    ],
    // The default schema pins `className` on <a> to a single literal value
    // (the footnote backref), which silently strips the wikilink classes and
    // leaves an empty class attribute. Drop the value restriction, keep the
    // rest of the allowances.
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((entry) => !Array.isArray(entry)),
      "className",
      "dataBroken",
    ],
    time: [...(defaultSchema.attributes?.time ?? []), "dateTime"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading"],
    span: ["tabIndex"],
  },
};

const isInfobox = (node: Element): boolean =>
  Array.isArray(node.properties?.className) && node.properties.className.includes("w-infobox");

/**
 * Pull infobox elements out of the tree, collecting them in document order.
 *
 * Nested infoboxes are not descended into - an infobox inside an infobox goes
 * along with its parent rather than being hoisted separately.
 */
function takeInfoboxes(parent: HastRoot | Element, into: Element[]): void {
  const kept = (parent.children as HastRoot["children"]).filter((child) => {
    if (child.type !== "element") return true;
    if (isInfobox(child)) {
      into.push(child);
      return false;
    }
    takeInfoboxes(child, into);
    return true;
  });
  // An element's children are a subset of a root's, so whatever survives the
  // filter is valid in either position.
  parent.children = kept as Element["children"];
}

export function renderMarkup(source: string, options: RenderOptions = {}): RenderResult {
  const widgets: WidgetReport = { unknown: [] };
  const linkReport: LinkReport = { links: [], broken: [] };
  const infoboxes: Element[] = [];
  let tree: HastRoot | undefined;
  let headings: Heading[] = [];

  const html = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkWikiLinks, {
      report: linkReport,
      exists: options.linkExists,
      base: options.linkBase ?? "/wiki/",
    })
    .use(remarkUnknownDirectives, { directives: DIRECTIVES, report: widgets })
    .use(remarkRehype, {
      allowDangerousHtml: false,
      handlers: directiveHandlers(DIRECTIVES),
    })
    .use(() => (node: HastRoot) => {
      // Must run *inside* the pipeline, not after it: collectHeadings writes
      // the anchor id onto each heading, and doing that after stringify would
      // leave the emitted HTML without ids while still reporting them.
      tree = node;
      headings = collectHeadings(node);
    })
    .use(rehypeSanitize, schema)
    .use(() => (node: HastRoot) => {
      // After sanitising, so what is lifted out is already safe to emit.
      if (options.extractInfoboxes) takeInfoboxes(node, infoboxes);
    })
    .use(rehypeStringify)
    .processSync(source)
    .toString();

  return {
    html,
    links: linkReport.links,
    brokenLinks: linkReport.broken,
    headings,
    excerpt: tree ? excerptOf(tree) : "",
    firstImage: tree ? firstImage(tree) : null,
    unknown: widgets.unknown,
    infoboxes: infoboxes.map((node) => toHtml(node)),
  };
}

export { wikiLinkTargets } from "./wikilinks.js";
export type { Heading } from "./derive.js";
export { DIRECTIVES, KNOWN_DIRECTIVES } from "./directives.js";
