/**
 * Верхний рельс и нижняя строка статуса — рамка, в которой стоит любой экран.
 *
 * Единый вид для всей системы, не только для этой вики: рельс — терминал
 * слева, марка системы посередине, вход справа; подвал — состояние канала и
 * часы слева, подпись посередине. Кроме адресной марки (у каждого экрана
 * системы своя) и того, что подставляет сама страница, содержимое рельса и
 * подвала не меняется от экрана к экрану и от системы к системе.
 *
 * Поиск в рельсе сделан кнопкой, а не полем ввода: набирают в командной строке,
 * и два фокусируемых поля на один поиск — верный способ получить в шапке
 * поле, которое молча ничего не делает. Она же и есть «строка терминала» —
 * приглашение командной строки, не отдельная декорация рядом с ним.
 */

import { href, navigate } from "./app-root.js";
import { el } from "./dom.js";
import { openSearch } from "./search-palette.js";

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

  /*
   * Летопись и карта командной строке уже известны — их находят там же, где
   * и запись, и категорию, — поэтому ссылками в рельсе они не дублируются.
   * Марка системы стоит по центру и ведёт домой: AETHER.OS — общая система,
   * Eclipse Protocol — то, чем она сейчас открыта именно здесь.
   */
  const brand = link("/", { class: "mark" }, [
    el("b", {}, ["AETHER", el("i", {}, ["."]), "OS"]),
    el("s", {}, ["Eclipse Protocol"]),
  ]);

  // Входа пока нет — служба подключена отдельно, — поэтому кнопка честно
  // говорит об этом при нажатии, а не изображает форму, которая никуда не
  // ведёт.
  const connect = el("button", { class: "btn btn--go btn--sm", type: "button" }, ["ПОДКЛЮЧИТЬСЯ"]);
  connect.addEventListener("click", () => {
    connect.textContent = "вход не подключён";
    connect.disabled = true;
  });

  return el("header", { class: "rail" }, [search, brand, connect]);
}

/**
 * Нижняя строка. Показывает только то, что действительно известно: состояние
 * канала, дату и часы. Всё остальное — счётчик страницы, служебные ссылки —
 * было бы содержимым экрана, а подвал у системы один и тот же везде.
 */
export function siteFoot(): HTMLElement {
  const clock = el("span", { class: "chrome" }, ["--.--.---- --:--:-- UTC"]);
  const tick = () => {
    const now = new Date();
    const date = now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    clock.textContent = `${date} ${now.toISOString().slice(11, 19)} UTC`;
  };
  tick();
  setInterval(tick, 1000);

  const status = el("div", { class: "foot__status" }, [
    el("span", { class: "chrome" }, [el("span", { class: "dot dot--live" }), "канал устойчив"]),
    clock,
  ]);

  return el("footer", { class: "foot" }, [status, el("span", { class: "chrome foot__brand" }, ["© OLDMAN CREATIONS, 2019"])]);
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
