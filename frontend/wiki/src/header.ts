/**
 * Site header: command line on the left, logo in the middle, reader on the
 * right - the arrangement from the old design, rebuilt without React.
 *
 * The search control is a button rather than an input on purpose: it opens the
 * palette, and the palette is where typing happens. Two focusable text fields
 * for one search is how you get a header field that silently does nothing.
 */

import { href, navigate } from "./app-root.js";
import { el, svg } from "./dom.js";
import { openSearch } from "./search-palette.js";

/** The live-signal diamond: outline plus a pulsing centre. */
function logoDiamond(): SVGElement {
  return svg(
    `<polygon points="6,0.75 11.25,6 6,11.25 0.75,6" fill="none" stroke="var(--primary)" stroke-width="1" />
     <polygon points="6,3.75 8.25,6 6,8.25 3.75,6" fill="var(--primary)" class="live-dot" />`,
    { viewBox: "0 0 12 12", width: "22", height: "22", "aria-hidden": "true" },
  );
}

function userCard(): HTMLElement {
  // No session yet: the auth service is a separate application and is not
  // wired in. Rather than fake a signed-in operator, the header states what is
  // true - an anonymous reader, cleared for nothing.
  const trigger = el("button", { class: "user-card", type: "button", "aria-haspopup": "true" }, [
    el("span", { class: "avatar avatar--sm" }, ["ГО"]),
    el("span", { class: "user-id" }, [
      el("b", {}, ["@гость"]),
      el("span", { class: "user-clearance" }, ["допуск · уровень 0"]),
    ]),
  ]);

  const menu = el("div", { class: "menu user-menu", hidden: true }, [
    el("button", { class: "menu-item", type: "button", disabled: true }, ["Вход не подключён"]),
    el("div", { class: "menu-sep" }),
    el("a", { class: "menu-item", href: "admin/" }, ["Админка"]),
    el("a", { class: "menu-item", href: "map/" }, ["Карта"]),
  ]);

  const wrap = el("div", { class: "user-wrap" }, [trigger, menu]);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  });
  return wrap;
}

export function siteHeader(): HTMLElement {
  const searchButton = el("button", { class: "cmd", type: "button" }, [
    el("span", { class: "cmd-prompt" }, [">"]),
    el("span", { class: "cmd-label" }, ["wiki search --query"]),
    el("kbd", { class: "kbd" }, ["Ctrl K"]),
  ]);
  searchButton.addEventListener("click", () => openSearch());

  const brand = el("a", { class: "brand", href: href("/") }, [
    logoDiamond(),
    el("span", { class: "brand-name" }, [
      "AETHER",
      el("span", { class: "accent" }, ["."]),
      "WIKI",
    ]),
  ]);
  brand.addEventListener("click", (event) => {
    event.preventDefault();
    navigate("/");
  });

  return el("header", { class: "site-head" }, [
    el("div", { class: "head-left" }, [searchButton]),
    brand,
    el("div", { class: "head-right" }, [userCard()]),
  ]);
}

/** Ctrl/⌘+K anywhere opens the palette, as in the old build. */
export function bindSearchShortcut(): void {
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSearch();
    }
  });
}
