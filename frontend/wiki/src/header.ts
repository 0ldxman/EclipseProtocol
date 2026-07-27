/**
 * Верхний рельс и нижняя строка статуса — рамка, в которой стоит любой экран.
 *
 * Поиск в рельсе сделан кнопкой, а не полем ввода: набирают в командной строке,
 * и два фокусируемых поля на один поиск — верный способ получить в шапке
 * поле, которое молча ничего не делает.
 */

import { href, navigate } from "./app-root.js";
import { el } from "./dom.js";
import { openSearch } from "./search-palette.js";

/** Уровень читателя. Сессии пока нет — сервис входа живёт отдельно. */
const CLEARANCE = 0;

function clearanceMeter(level: number, of = 5): HTMLElement {
  return el(
    "span",
    { class: "clr", title: `допуск · уровень ${level}` },
    Array.from({ length: of }, (_, i) => el("i", { class: i < Math.max(level, 1) ? "on" : "" })),
  );
}

function link(route: string, attrs: Record<string, string>, children: (Node | string)[]): HTMLElement {
  const anchor = el("a", { ...attrs, href: href(route) }, children);
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(route);
  });
  return anchor;
}

export function siteRail(): HTMLElement {
  const search = el("button", { class: "cmd", type: "button" }, [
    "поиск или команда",
    el("kbd", {}, ["CTRL K"]),
  ]);
  search.addEventListener("click", () => openSearch());

  // Знак марки намеренно не янтарный: янтарный обозначает состояние,
  // а марка — не состояние.
  const brand = link("/", { class: "mark" }, [
    el("i", {}, ["◆"]),
    el("b", {}, ["AETHER.WIKI"]),
  ]);

  /*
   * Летопись и карта — не содержимое главной, а соседние экраны того же
   * архива, и место им в рельсе. Раньше они лежали плиткой «другие входы» в
   * нижнем углу главной: со второй страницы туда было не попасть вовсе, и
   * два из трёх экранов сайта существовали только для того, кто дошёл до
   * конца первого.
   */
  const nav = el("nav", { class: "rail__nav" }, [
    link("/timeline", {}, ["летопись"]),
    el("a", { href: href("/") + "map/" }, ["карта"]),
  ]);

  return el("header", { class: "rail" }, [
    brand,
    nav,
    search,
    el("div", { class: "who" }, [
      el("div", {}, [
        el("div", { class: "chrome chrome--on" }, ["@гость"]),
        el("div", { class: "chrome" }, [
          "допуск ",
          el("span", { class: "chrome--amber" }, [String(CLEARANCE)]),
        ]),
      ]),
      clearanceMeter(CLEARANCE),
    ]),
  ]);
}

/**
 * Нижняя строка. Показывает только то, что действительно известно: время,
 * счётчик записей подставляется страницей, когда она его знает.
 */
export function siteFoot(): HTMLElement {
  const clock = el("span", { class: "chrome" }, ["--:--:-- UTC"]);
  const tick = () => {
    clock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
  };
  tick();
  setInterval(tick, 1000);

  // Служебная строка: то, что относится к сайту, а не к тому, что на экране.
  // Сюда же со временем встанут внешние ссылки — подвал для них и есть место,
  // а не рельс, где каждая лишняя строка отбирает внимание у поиска.
  return el("footer", { class: "foot" }, [
    el("span", { class: "chrome" }, [el("span", { class: "dot dot--live" }), "канал устойчив"]),
    clock,
    el("span", { class: "chrome", id: "foot-count" }, []),
    el("span", { class: "chrome sp" }, [
      el("a", { class: "foot__link", href: href("/") + "admin/" }, ["админка"]),
    ]),
    el("span", { class: "chrome" }, ["ЭП — 2026"]),
  ]);
}

/** Счётчик в подвале ставит та страница, которая его знает. */
export function setFootCount(text: string): void {
  const slot = document.getElementById("foot-count");
  if (slot) slot.textContent = text;
}

/** Ctrl/⌘+K где угодно открывает командную строку. */
export function bindSearchShortcut(): void {
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSearch();
    }
  });
}
