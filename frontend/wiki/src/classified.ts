/**
 * What a reader sees instead of a record they are not cleared for.
 *
 * The noise is decoration over an absence, not a cipher: the server never sends
 * the text, so there is nothing here to un-blur. Showing the record's existence
 * and withholding its content is deliberate - in a setting built on secrets, a
 * page that simply is not there says less than one that refuses.
 */

import { el } from "./dom.js";

const GLYPHS = [..."ABCDEF0123456789█▓▒░#%&/\\<>{}[]·:=+АБВГДЕЖЗИКЛМНОПРСТ"];

/** Lehmer generator: the same seed gives the same wall of noise. */
function rng(seed: number): () => number {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

function noiseLines(seed: number, count: number): string[] {
  const next = rng(seed);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = 26 + Math.floor(next() * 54);
    let line = "";
    for (let j = 0; j < length; j++) line += GLYPHS[Math.floor(next() * GLYPHS.length)];
    lines.push(line);
  }
  return lines;
}

export function classifiedBlock(level: number, lines = 16): HTMLElement {
  const body = el("div", { class: "noise", title: "доступ запрещён" });
  let seed = 7;
  const fill = () => body.replaceChildren(...noiseLines(seed, lines).map((l) => el("div", {}, [l])));
  fill();
  // Re-scrambling on click is the one interaction: it makes plain that the
  // characters carry nothing.
  body.addEventListener("click", () => {
    seed += 1;
    fill();
  });

  return el("div", { class: "classified" }, [
    el("div", { class: "classified-bar" }, [
      el("span", {}, ["classified — содержимое засекречено"]),
      el("span", { class: "classified-level" }, [`// требуется допуск: уровень ${level}`]),
    ]),
    body,
    el("p", { class: "classified-foot" }, [
      "// decryption failed — invalid clearance · допуск не подтверждён",
    ]),
  ]);
}
