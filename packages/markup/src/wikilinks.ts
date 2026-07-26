/**
 * `[[Кремень|kremen]]` and `[[kremen]]` links.
 *
 * Targets are flat slugs, never folder paths. That is deliberate: the admin is
 * a file manager where records get reorganised constantly, and if a link
 * encoded the folder, every move would break every link to it. The folder is
 * where a record *lives*; the slug is what it *is*.
 *
 * An unresolved link still renders - marked, not removed. A red link is a
 * to-do; a disappearing one is a silent hole in the text.
 */

import type { Root, Text, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

export interface LinkReport {
  links: string[];
  broken: string[];
}

interface Options {
  report: LinkReport;
  exists?: (slug: string) => boolean;
  base: string;
}

// Non-greedy, and rejects brackets inside so an unclosed "[[" cannot swallow
// the rest of the paragraph.
const WIKILINK = /\[\[([^[\]|]+?)(?:\|([^[\]|]+?))?\]\]/g;

/**
 * Link targets in a source document, without rendering it.
 *
 * The link graph is wanted for every record at once - to answer "what points
 * here?" - and running the whole pipeline over the entire wiki to collect a
 * handful of slugs would be paying for HTML nobody asked for.
 */
export function wikiLinkTargets(source: string): string[] {
  const out: string[] = [];
  WIKILINK.lastIndex = 0;
  for (let match = WIKILINK.exec(source); match; match = WIKILINK.exec(source)) {
    const slug = (match[2] ?? match[1] ?? "").trim();
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export function remarkWikiLinks(options: Options) {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const value = node.value;
      if (!value.includes("[[")) return;

      const pieces: PhrasingContent[] = [];
      let cursor = 0;
      WIKILINK.lastIndex = 0;

      for (let match = WIKILINK.exec(value); match; match = WIKILINK.exec(value)) {
        const [whole, first, second] = match;
        // `[[Display|slug]]` - display first, matching the old wiki's order.
        const display = (second ? first : first)!.trim();
        const slug = (second ?? first)!.trim();

        if (match.index > cursor) {
          pieces.push({ type: "text", value: value.slice(cursor, match.index) });
        }

        if (!options.report.links.includes(slug)) options.report.links.push(slug);
        const missing = options.exists ? !options.exists(slug) : false;
        if (missing && !options.report.broken.includes(slug)) options.report.broken.push(slug);

        pieces.push({
          type: "link",
          url: `${options.base}${encodeURIComponent(slug)}`,
          children: [{ type: "text", value: display }],
          data: {
            hProperties: {
              className: missing ? ["wikilink", "is-broken"] : ["wikilink"],
              ...(missing ? { dataBroken: "true" } : {}),
            },
          },
        });

        cursor = match.index + whole.length;
      }

      if (pieces.length === 0) return;
      if (cursor < value.length) pieces.push({ type: "text", value: value.slice(cursor) });
      (parent.children as PhrasingContent[]).splice(index, 1, ...pieces);
      return index + pieces.length;
    });
  };
}
