/**
 * Летопись.
 *
 * Лента собирается из самих записей: событием запись делает дата в её
 * свойствах, оттуда же берутся подпись и снимок карточки. Отдельного
 * хранилища у хронологии нет, поэтому она не может разойтись с записями, из
 * которых состоит.
 *
 * Внизу страницы горит огонь — не украшение, а конец ленты: событий больше
 * нет, эпоха продолжается. Это canvas, потому что дым должен клубиться, а не
 * мигать по ключевым кадрам, и потому что квадратная искра держит связь с
 * моноширинной сеткой всего остального.
 */

import { href, navigate } from "./app-root.js";
import { timeline, type Timeline, type TimelineEvent } from "./api.js";
import { el } from "./dom.js";
import { setFootCount } from "./header.js";

const YEAR = (at: string): string => at.slice(0, 4);

/** Русское склонение: 1 событие, 2 события, 5 событий. */
function plural(n: number, forms: [string, string, string]): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return `${n} ${forms[0]}`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

const EVENTS: [string, string, string] = ["событие", "события", "событий"];

function eventCard(event: TimelineEvent, side: "l" | "r"): HTMLElement {
  // Снимок и подпись — свойства события, а не выжимка из тела записи: то, чем
  // событие показывает себя в ленте, выбирает автор.
  const shot = event.image
    ? el("span", { class: "shot" }, [el("img", { src: event.image, alt: "", loading: "lazy" })])
    : null;

  const card = el("a", { class: "card", href: href(`/wiki/${event.slug}`) }, [
    shot,
    el("span", { class: "txt" }, [
      el("div", { class: "line" }, [
        el("span", { class: "date" }, [event.at]),
        el("span", { class: "name" }, [event.title]),
      ]),
      event.summary
        ? el("div", { class: "extra" }, [event.summary])
        : event.restricted
          ? el("div", { class: "extra" }, [`Содержание доступно с допуска ${event.access}.`])
          : null,
      event.restricted ? el("span", { class: "tag" }, [`допуск ${event.access}`]) : null,
    ]),
  ]);
  card.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(`/wiki/${event.slug}`);
  });

  return el("div", { class: `ev ev--${side}${event.restricted ? " ev--sealed" : ""}` }, [
    el("span", { class: "node" }),
    el("span", { class: "conn" }),
    card,
  ]);
}

function spine(data: Timeline): HTMLElement {
  const rail = el("div", { class: "tl" }, [
    el("div", { class: "spine" }),
    el("div", { class: "firewrap" }, [el("canvas", { id: "tl-fire" })]),
  ]);

  // Плашка эпохи ставится только у названной. События до первой эпохи — а они
  // и есть предыстория — идут от начала ленты без заголовка.
  let epoch = "";
  let side: "l" | "r" = "l";
  for (const event of data.events) {
    if (event.epoch && event.epoch !== epoch) {
      epoch = event.epoch;
      const meta = data.epochs.find((e) => e.name === epoch);
      const span =
        meta && YEAR(meta.from) !== YEAR(meta.to)
          ? `${YEAR(meta.from)}—${YEAR(meta.to)}`
          : YEAR(meta?.from ?? event.at);
      rail.append(
        el("div", { class: "epoch" }, [
          el("div", {}, [
            el("span", { class: "no" }, [`— эпоха ${roman(data.epochs.indexOf(meta!) + 1)} —`]),
            el("span", { class: "nm" }, [epoch]),
            el("span", { class: "sub" }, [`${span} · ${plural(meta?.count ?? 0, EVENTS)}`]),
          ]),
        ]),
      );
    }
    rail.append(eventCard(event, side));
    side = side === "l" ? "r" : "l";
  }

  const last = data.epochs.at(-1);
  rail.append(
    el("div", { class: "now" }, [
      el("b", {}, [`сейчас · ${new Date().getFullYear()}`]),
      el("span", {}, [last ? `эпоха «${last.name}» продолжается` : "летопись пуста"]),
    ]),
  );
  return rail;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = (n: number): string => ROMAN[n] ?? String(n);

export async function renderTimeline(view: HTMLElement): Promise<void> {
  const data = await timeline();

  const strip = el("div", { class: "strip" }, [
    el("span", { class: "chrome" }, [el("span", { class: "dot" }), "обзор — летопись протокола"]),
    data.events.length > 0
      ? el("span", { class: "chrome" }, [
          `${YEAR(data.events[0]!.at)} → ${YEAR(data.events.at(-1)!.at)}`,
        ])
      : null,
    el("span", { class: "chrome sp" }, ["наведи на точку"]),
  ]);

  const page = el("div", { class: "tl-page" }, [
    el("div", { class: "hero" }, [
      el("h1", {}, ["ECLIPSE ", el("em", {}, ["PROTOCOL"])]),
      el("div", { class: "hero__sub" }, ["хронология"]),
    ]),
  ]);

  if (data.events.length === 0) {
    page.append(
      el("div", { class: "empty" }, [
        el("b", {}, ["летопись пуста"]),
        el("span", {}, [
          "Событие появится здесь, как только у записи будет дата:",
          el("br"),
          "свойства записи → «Событие»",
        ]),
      ]),
    );
  } else {
    page.append(spine(data));
  }

  view.replaceChildren(strip, page);
  setFootCount(`${plural(data.epochs.length, ["эпоха", "эпохи", "эпох"])} · ${plural(data.events.length, EVENTS)}`);
  document.title = "Хронология — AETHER.WIKI";

  if (data.events.length > 0) startFire(page.querySelector<HTMLCanvasElement>("#tl-fire")!);
}

/* ── огонь ──────────────────────────────────────────────────────────────
   Тепловая шкала от угля к белому пламени, заранее натонированные пятна
   свечения по уровням жара, клубы дыма и квадратные пиксельные искры. */

export function startFire(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const RISE = 720;
  let sparkRise = 540;
  let width = 0;
  let height = 0;

  const heat = (t: number): [number, number, number] => {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const a: [number, number, number] = [58, 10, 8];
    const b: [number, number, number] = [214, 74, 26];
    const c: [number, number, number] = [255, 210, 132];
    const [from, to, k] =
      clamped < 0.55 ? [a, b, clamped / 0.55] : [b, c, (clamped - 0.55) / 0.45];
    return [
      (from[0] + (to[0] - from[0]) * k) | 0,
      (from[1] + (to[1] - from[1]) * k) | 0,
      (from[2] + (to[2] - from[2]) * k) | 0,
    ];
  };

  const LEVELS = 16;
  const SPRITE = 128;
  const sprites: HTMLCanvasElement[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const [r, g, b] = heat(i / (LEVELS - 1));
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = SPRITE;
    const sc = sprite.getContext("2d")!;
    const gradient = sc.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    gradient.addColorStop(0, `rgba(${r},${g},${b},.95)`);
    gradient.addColorStop(0.42, `rgba(${r},${g},${b},.32)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    sc.fillStyle = gradient;
    sc.fillRect(0, 0, SPRITE, SPRITE);
    sprites.push(sprite);
  }

  interface Puff {
    x: number; y: number; r: number; vx: number; vy: number;
    life: number; decay: number; seed: number; sway: number;
  }
  interface Spark {
    x: number; y: number; r: number; vx: number; vy: number;
    life: number; decay: number; seed: number;
  }

  const puffs: Puff[] = [];
  const sparks: Spark[] = [];

  const newPuff = (spread: boolean): Puff => ({
    x: Math.random() * width,
    y: spread ? height - Math.random() * RISE : height + Math.random() * 24,
    r: 22 + Math.random() * 46,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -(0.6 + Math.random() * 1.5),
    life: spread ? 0.2 + Math.random() * 0.8 : 1,
    decay: 0.0012 + Math.random() * 0.0018,
    seed: Math.random() * 6.283,
    sway: 0.4 + Math.random() * 0.9,
  });

  const newSpark = (): Spark => ({
    x: Math.random() * width,
    y: height + 2,
    r: 0.6 + Math.random() * 1.5,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -(2.2 + Math.random() * 3.6),
    life: 1,
    decay: 0.0011 + Math.random() * 0.0018,
    seed: Math.random() * 6.283,
  });

  const resize = (): void => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    sparkRise = height * 0.5;
    puffs.length = 0;
    const count = Math.max(120, Math.round(width / 4));
    for (let i = 0; i < count; i++) puffs.push(newPuff(true));
  };

  let t = 0;
  const step = (): void => {
    t += 0.016;
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i]!;
      p.life -= p.decay;
      p.y += p.vy;
      p.x += p.vx + Math.sin(t * p.sway + p.seed) * 0.7;
      p.vy *= 0.997;
      p.r += 0.16; // клуб раздувается на подъёме
      if (p.life <= 0 || height - p.y > RISE) puffs[i] = newPuff(false);
    }
    if (Math.random() < 0.8) sparks.push(newSpark());
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.life -= s.decay;
      s.y += s.vy;
      s.x += s.vx + Math.sin(t * 3 + s.seed) * 0.5;
      s.vy *= 0.997;
      if (s.life <= 0 || height - s.y > sparkRise) sparks.splice(i, 1);
    }
    if (sparks.length > 640) sparks.splice(0, sparks.length - 640);
  };

  const render = (): void => {
    ctx.clearRect(0, 0, width, height);

    // Зарево привязано к пикселям от низа, иначе оно растёт вместе с лентой.
    const at = (px: number): number => Math.max(0, 1 - px / height);
    const glow = ctx.createLinearGradient(0, 0, 0, height);
    glow.addColorStop(0, "rgba(120,30,16,0)");
    glow.addColorStop(at(1020), "rgba(120,30,16,0)");
    glow.addColorStop(at(640), "rgba(150,42,20,.06)");
    glow.addColorStop(at(250), "rgba(176,54,26,.16)");
    glow.addColorStop(1, "rgba(210,80,34,.34)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const p of puffs) {
      const level = Math.max(0, 1 - (height - p.y) / RISE) * (0.4 + 0.6 * p.life);
      ctx.globalAlpha = 0.082 * p.life * (0.35 + 0.9 * level);
      ctx.drawImage(
        sprites[Math.min(LEVELS - 1, (level * (LEVELS - 1)) | 0)]!,
        p.x - p.r,
        p.y - p.r,
        p.r * 2,
        p.r * 2,
      );
    }

    ctx.globalAlpha = 1;
    for (const s of sparks) {
      const fade = Math.max(0, Math.min(1, (sparkRise - (height - s.y)) / (sparkRise * 0.34)));
      const [r, g, b] = heat(0.7 + 0.3 * s.life);
      const flicker = 0.55 + 0.45 * Math.sin(t * 12 + s.seed);
      const size = Math.max(1, Math.round(s.r * 1.9));
      ctx.fillStyle = `rgba(${r},${g},${b},${s.life * flicker * fade})`;
      ctx.fillRect(s.x | 0, s.y | 0, size, size); // искра квадратная, по сетке
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  addEventListener("resize", resize);
  resize();
  render();
  if (still) return; // один кадр вместо цикла

  let last = 0;
  const loop = (ts: number): void => {
    // Экран мог смениться — тогда цикл прекращается сам.
    if (!canvas.isConnected) return;
    requestAnimationFrame(loop);
    if (ts - last < 33) return; // 30 к/с довольно для дыма
    last = ts;
    step();
    render();
  };
  requestAnimationFrame(loop);
}
