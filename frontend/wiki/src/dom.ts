/**
 * Tiny element helper.
 *
 * Not a framework - the pages here are static once rendered, and the parts that
 * do change (search results, the active table-of-contents anchor) are small
 * enough to touch directly. What this buys is that markup is written as data,
 * so a class name typo is a missing style rather than a silent parse.
 */

type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string;
  id?: string;
  href?: string;
  title?: string;
  type?: string;
  html?: string;
  [key: string]: string | number | boolean | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** SVG needs its own namespace; the diamonds are the only reason this exists. */
export function svg(markup: string, attrs: Record<string, string> = {}): SVGElement {
  const wrapper = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries(attrs)) wrapper.setAttribute(key, value);
  wrapper.innerHTML = markup;
  return wrapper;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
