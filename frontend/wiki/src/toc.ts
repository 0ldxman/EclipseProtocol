/**
 * Оглавление записи: волосяная линия слева от документа, ромб на каждый
 * заголовок и название раздела рядом с ромбом.
 *
 * Названия здесь появились не для красоты. Рельс из одних ромбов занимал
 * колонку слева от документа и не сообщал ничего: чтобы понять, куда ведёт
 * ромб, приходилось в него целиться. Раздел, который читают сейчас, горит
 * янтарём — это и есть указатель места.
 */

import type { Heading } from "./api.js";
import { el } from "./dom.js";

/**
 * Глубина считается от самого мелкого уровня в записи, а не от h1.
 * Страница печатает заголовок записи сама, поэтому документы обычно начинаются
 * с h2 — и эти разделы верхний уровень рельса, а не подразделы невидимого.
 */
function depthScale(items: Heading[]): (heading: Heading) => number {
  const top = Math.min(...items.map((item) => item.level));
  return (heading) => Math.min(2, Math.max(0, heading.level - top));
}

export function articleToc(items: Heading[], scroller: HTMLElement): HTMLElement | null {
  if (items.length < 2) return null;

  const depthOf = depthScale(items);
  const rows = items.map((heading) => {
    const anchor = el("a", { href: `#${heading.id}` }, [
      el("i"),
      el("span", {}, [heading.text]),
    ]);
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return el("li", { class: depthOf(heading) > 0 ? "sub" : "" }, [anchor]);
  });

  const rail = el("nav", { class: "toc", "aria-label": "Разделы записи" }, [
    el("span", { class: "chrome" }, ["разделы"]),
    el("ol", {}, rows),
  ]);

  const mark = (id: string): void => {
    const at = items.findIndex((heading) => heading.id === id);
    if (at < 0) return;
    rows.forEach((row, i) => row.classList.toggle("on", i === at));
  };

  /* Заголовок считается текущим, пока он в верхней трети окна: так активным
     становится раздел, который читают, а не тот, что мелькнул внизу. */
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) mark(visible.target.id);
    },
    { root: null, rootMargin: "0px 0px -70% 0px", threshold: 0 },
  );

  for (const heading of items) {
    const node = document.getElementById(heading.id);
    if (node) observer.observe(node);
  }
  mark(items[0]!.id);
  void scroller;
  return rail;
}
