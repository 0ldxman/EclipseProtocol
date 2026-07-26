/**
 * The anchor rail: a thin amber line down the left of the article with a
 * diamond per heading, from the old design.
 *
 * It carries no text. Labels appear on hover, which is what lets the rail be
 * 32px wide and leaves the article the width it needs. Depth is shown by the
 * size of the diamond, and only the sections of the heading you are currently
 * in are expanded - the rail stays short on a long record instead of becoming
 * a second document.
 */

import type { Heading } from "./api.js";
import { el, svg } from "./dom.js";

type Depth = 1 | 2 | 3;

const SIZE: Record<Depth, number> = { 1: 16, 2: 12, 3: 10 };

/**
 * Depth is relative to the shallowest heading in the record, not to `h1`.
 * The page prints the record's title itself, so most documents start at `h2` -
 * and those sections are the top level of the rail, not sub-sections of a
 * heading that is not shown.
 */
function depthScale(items: Heading[]): (heading: Heading) => Depth {
  const top = Math.min(...items.map((item) => item.level));
  return (heading) => Math.min(3, Math.max(1, heading.level - top + 1)) as Depth;
}

function diamond(depth: Depth, active: boolean): SVGElement {
  const size = String(SIZE[depth]);
  return svg(
    `<polygon points="6,0.75 11.25,6 6,11.25 0.75,6" fill="var(--background)" stroke="var(--primary)" stroke-width="1" />
     <polygon points="6,4 8,6 6,8 4,6" fill="var(--primary)" opacity="${active ? 1 : 0}" />`,
    { viewBox: "0 0 12 12", width: size, height: size, "aria-hidden": "true" },
  );
}

type DepthOf = (heading: Heading) => Depth;

/** The active heading plus every heading that contains it. */
function activePath(items: Heading[], activeId: string | null, depthOf: DepthOf): Set<string> {
  const path = new Set<string>();
  if (!activeId) return path;
  const at = items.findIndex((item) => item.id === activeId);
  if (at < 0) return path;
  path.add(activeId);
  let depth = depthOf(items[at]!);
  for (let i = at - 1; i >= 0 && depth > 1; i--) {
    const candidate = depthOf(items[i]!);
    if (candidate < depth) {
      path.add(items[i]!.id);
      depth = candidate;
    }
  }
  return path;
}

/** A sub-heading is shown only while its top-level section is the active one. */
function visible(items: Heading[], i: number, path: Set<string>, depthOf: DepthOf): boolean {
  if (depthOf(items[i]!) === 1) return true;
  for (let j = i - 1; j >= 0; j--) {
    if (depthOf(items[j]!) === 1) return path.has(items[j]!.id);
  }
  return true;
}

export function articleToc(headings: Heading[], scrollRoot: HTMLElement): HTMLElement | null {
  const items = headings.filter((heading) => heading.level <= 3);
  if (items.length === 0) return null;
  const depthOf = depthScale(items);

  const nav = el("nav", { class: "toc", "aria-label": "Навигация по записи" });
  const line = el("span", { class: "toc-line", "aria-hidden": "true" });
  const listEl = el("ol", { class: "toc-list" }, [line]);
  nav.append(listEl);

  let active: string | null = items[0]?.id ?? null;

  const draw = () => {
    const path = activePath(items, active, depthOf);
    listEl.replaceChildren(line);
    for (const [i, item] of items.entries()) {
      if (!visible(items, i, path, depthOf)) continue;
      const link = el("a", { class: "toc-dot", href: `#${item.id}`, title: item.text }, [
        diamond(depthOf(item), path.has(item.id)),
        el("span", { class: "tooltip toc-label" }, [item.text]),
      ]);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      listEl.append(el("li", {}, [link]));
    }
  };

  // Scroll-spy. The bottom margin keeps the "current" heading the one near the
  // top of the viewport rather than whichever happens to be visible at all.
  const targets = items
    .map((item) => document.getElementById(item.id))
    .filter((node): node is HTMLElement => node !== null);

  if (targets.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = seen[0];
        if (first && first.target.id !== active) {
          active = first.target.id;
          draw();
        }
      },
      { root: scrollRoot === document.documentElement ? null : scrollRoot, rootMargin: "0px 0px -70% 0px" },
    );
    for (const target of targets) observer.observe(target);
  }

  draw();
  return nav;
}
