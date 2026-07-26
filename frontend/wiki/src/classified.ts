/**
 * Запись выше допуска читателя.
 *
 * Тело такой записи сервер не отдаёт вовсе — сюда приходит только её размер.
 * Поэтому здесь не «скрытый текст», а честная имитация вымаранного документа:
 * настоящая бумага, на ней плашки правдоподобной длины и приписка, сколько
 * знаков в скольких разделах закрыто.
 *
 * Раньше на этом месте стояла шумовая стена. Она выглядела эффектнее, но не
 * говорила читателю ничего: ни что запись существует, ни какого она объёма,
 * ни какой уровень нужен, чтобы её прочесть.
 */

import { el } from "./dom.js";

export interface Hidden {
  chars: number;
  sections: number;
  attachments: number;
}

/**
 * Детерминированный генератор.
 *
 * Плашки должны ложиться одинаково при каждом открытии одной и той же записи:
 * прыгающая по перезагрузке разметка читается как поломка, а не как документ.
 */
function lehmer(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return Math.abs(hash);
}

/** Одна вымаранная строка: чередование плашек и коротких просветов. */
function redactedLine(random: () => number, width: number): HTMLElement {
  const line = el("p", {});
  let left = width;
  while (left > 8) {
    const run = Math.min(left, 12 + Math.floor(random() * 34));
    line.append(el("span", { class: "w-classified" }, [" ".repeat(run)]));
    left -= run;
    if (left > 8) {
      const gap = 1 + Math.floor(random() * 3);
      line.append(" ".repeat(gap));
      left -= gap;
    }
  }
  return line;
}

/**
 * Лист закрытой записи.
 *
 * Слаг идёт в семя, чтобы разные записи выглядели по-разному, а одна и та же
 * запись — всегда одинаково.
 */
export function classifiedBody(slug: string, hidden: Hidden | undefined, required: number): HTMLElement {
  const random = lehmer(seedOf(slug));
  const sections = Math.min(Math.max(hidden?.sections ?? 0, 2), 6);
  const chars = hidden?.chars ?? 0;

  // Строк ровно столько, чтобы показать объём: около семидесяти знаков в строке
  // при этой ширине колонки.
  const total = Math.max(6, Math.min(26, Math.round(chars / 70)));
  const perSection = Math.max(2, Math.floor(total / sections));

  const body = el("div", { class: "prose" });
  for (let s = 0; s < sections; s++) {
    body.append(
      el("h2", {}, [
        el("span", { class: "w-classified" }, [" ".repeat(9 + Math.floor(random() * 8))]),
      ]),
    );
    for (let i = 0; i < perSection; i++) {
      body.append(redactedLine(random, 58 + Math.floor(random() * 16)));
    }
  }

  const counts = [
    hidden && hidden.chars > 0 ? `${hidden.chars.toLocaleString("ru-RU")} знаков` : null,
    hidden && hidden.sections > 0 ? `${hidden.sections} разделов` : null,
    hidden && hidden.attachments > 0 ? `${hidden.attachments} вложений` : null,
  ].filter(Boolean) as string[];

  body.append(
    el("div", { class: "w-note is-danger" }, [
      el("b", {}, ["закрыто"]),
      el("p", {}, [
        `Текст доступен с допуска ${required}, ваш уровень — 0. Видны заголовок, структура и связи.`,
        counts.length > 0 ? ` Скрыто: ${counts.join(", ")}.` : "",
      ]),
    ]),
  );

  return body;
}
