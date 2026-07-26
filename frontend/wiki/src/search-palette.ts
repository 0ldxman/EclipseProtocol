/**
 * Search palette.
 *
 * Opens over the page, takes the keyboard, and searches as you type. Requests
 * are debounced and stamped: a slow answer for "кре" must not overwrite the
 * results for "кремень" typed a moment later, which is the classic way a
 * search box ends up showing the wrong list.
 */

import { navigate } from "./app-root.js";
import { search, type SearchHit } from "./api.js";
import { clear, el } from "./dom.js";

let overlay: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLElement | null = null;
let hits: SearchHit[] = [];
let cursor = 0;
let generation = 0;
let timer: number | undefined;

function highlight(): void {
  if (!list) return;
  for (const [i, row] of [...list.children].entries()) {
    row.classList.toggle("is-active", i === cursor);
    if (i === cursor) row.scrollIntoView({ block: "nearest" });
  }
}

function choose(): void {
  const hit = hits[cursor];
  if (!hit) return;
  closeSearch();
  navigate(`/wiki/${hit.slug}`);
}

function renderResults(): void {
  if (!list) return;
  clear(list);
  if (hits.length === 0) {
    list.append(el("div", { class: "palette-empty muted" }, ["ничего не найдено"]));
    return;
  }
  for (const [i, hit] of hits.entries()) {
    const row = el("button", { class: "palette-row", type: "button" }, [
      el("span", { class: "palette-title" }, [hit.title]),
      hit.restricted
        ? el("span", { class: "badge badge--destructive" }, ["допуск"])
        : el("span", { class: "palette-slug muted" }, [hit.slug]),
      hit.snippet ? el("span", { class: "palette-snippet muted" }, [hit.snippet]) : null,
    ]);
    row.addEventListener("mouseenter", () => {
      cursor = i;
      highlight();
    });
    row.addEventListener("click", choose);
    list.append(row);
  }
  highlight();
}

function run(query: string): void {
  const stamp = ++generation;
  if (query.trim().length < 2) {
    hits = [];
    renderResults();
    return;
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void search(query)
      .then((response) => {
        if (stamp !== generation) return; // a newer query already answered
        hits = response.results;
        cursor = 0;
        renderResults();
      })
      .catch(() => {
        if (stamp !== generation) return;
        hits = [];
        renderResults();
      });
  }, 120);
}

function build(): HTMLElement {
  input = el("input", {
    class: "input palette-input",
    type: "search",
    placeholder: "wiki search --query",
    autocomplete: "off",
    spellcheck: "false",
  });
  list = el("div", { class: "palette-list" });

  const box = el("div", { class: "palette panel" }, [
    el("div", { class: "palette-head" }, [
      el("span", { class: "cmd-prompt" }, [">"]),
      input,
      el("kbd", { class: "kbd" }, ["Esc"]),
    ]),
    list,
  ]);

  const node = el("div", { class: "palette-overlay", hidden: true }, [box]);
  node.addEventListener("click", (event) => {
    if (event.target === node) closeSearch();
  });
  input.addEventListener("input", () => run(input!.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSearch();
    else if (event.key === "ArrowDown") {
      event.preventDefault();
      cursor = Math.min(cursor + 1, Math.max(0, hits.length - 1));
      highlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose();
    }
  });

  document.body.append(node);
  return node;
}

export function openSearch(): void {
  overlay ??= build();
  overlay.hidden = false;
  input?.focus();
  input?.select();
}

export function closeSearch(): void {
  if (overlay) overlay.hidden = true;
}
