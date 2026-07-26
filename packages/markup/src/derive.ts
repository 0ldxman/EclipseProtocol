/**
 * Values derived from a rendered record, computed from the same tree that was
 * turned into HTML rather than by re-parsing the output.
 *
 * These are what the rest of the wiki actually needs: a table of contents, a
 * hovercard excerpt, a thumbnail for timeline entries and search results.
 */

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import { toString } from "hast-util-to-string";

export interface Heading {
  level: number;
  id: string;
  text: string;
}

/**
 * Anchor id for a heading. `\w` covers Cyrillic under the `u` flag, so Russian
 * headings get readable slugs instead of a string of dashes. Duplicates are
 * suffixed so two "Обзор" sections still address separately.
 */
function slugify(value: string, seen: Map<string, number>): string {
  const base =
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function collectHeadings(tree: Root): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  visit(tree, "element", (node: Element) => {
    if (!HEADINGS.has(node.tagName)) return;
    const text = toString(node).trim();
    if (!text) return;
    const id = slugify(text, seen);
    node.properties = { ...node.properties, id };
    out.push({ level: Number(node.tagName.slice(1)), id, text });
  });
  return out;
}

/** Prose only: headings and widget chrome are not part of a summary. */
const EXCERPT_SKIP = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "figcaption", "aside"]);

export function excerptOf(tree: Root, words = 28): string {
  const parts: string[] = [];
  visit(tree, "element", (node: Element) => {
    if (EXCERPT_SKIP.has(node.tagName)) return "skip";
    if (node.tagName !== "p") return;
    parts.push(toString(node));
    return "skip";
  });
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  const tokens = text.split(" ");
  if (tokens.length <= words) return text;
  return `${tokens.slice(0, words).join(" ").replace(/[,.;:—-]+$/, "")}…`;
}

export function firstImage(tree: Root): string | null {
  let found: string | null = null;
  visit(tree, "element", (node: Element) => {
    if (found || node.tagName !== "img") return;
    const src = node.properties?.["src"];
    if (typeof src === "string" && src.trim()) found = src.trim();
  });
  return found;
}
