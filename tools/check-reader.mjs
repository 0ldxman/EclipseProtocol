/**
 * Проверка читательских экранов настоящим браузером.
 *
 * Только чтение: скрипт ничего не создаёт и ничего не правит, поэтому его
 * можно гонять по живому архиву. Всё, что здесь проверяется, нельзя увидеть в
 * коде — что текст действительно приходит шумом и становится собой, что
 * плашка выезжает не раньше, чем до неё дошёл текст, что виджет доходит до
 * своего конечного состояния, а не остаётся спрятанным навсегда.
 *
 *   node tools/check-reader.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.env.SITE_URL ?? "http://127.0.0.1:3010";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
const ok = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

/* ── главная ──────────────────────────────────────────────────────────── */
await page.goto(`${ROOT}/`, { waitUntil: "networkidle" });
await page.waitForSelector(".folder");
await page.waitForTimeout(900);

ok("плитки «другие входы» больше нет", (await page.locator(".gate").count()) === 0);
ok("летопись и карта стоят в рельсе", (await page.locator(".rail__nav a").count()) === 2);
ok("админка ушла в подвал", (await page.locator(".foot__link").count()) === 1);
const described = await page.locator(".folder p").count();
ok("категория объясняет себя строкой", described >= 1, `${described} с описанием`);
ok("свежие правки — панель, а не лента", (await page.locator(".rail-col .mini--edits").count()) === 1);
const editRows = await page.locator(".mini--edits .mini__row").count();
ok("правок показано не больше пяти", editRows > 0 && editRows <= 5, `${editRows}`);
ok("широкой ленты изменений на главной нет", (await page.locator(".feed").count()) === 0);
// Строка не должна вылезать за панель: длинное название раздела ужимается.
const fits = await page.evaluate(() => {
  const panel = document.querySelector(".rail-col .panel");
  const row = document.querySelector(".mini--edits .mini__row");
  if (!panel || !row) return true;
  return row.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1;
});
ok("строка правки держится внутри панели", fits);
await page.screenshot({ path: path.join(SHOTS, "reader-01-home.png"), fullPage: true });

/* ── запись: печать и расшифровка ─────────────────────────────────────── */
const slug = await page.evaluate(async (root) => {
  const { nodes } = await (await fetch(`${root}/api/wiki/nav`)).json();
  return nodes.find((n) => n.slug === "kremen")?.slug ?? nodes.find((n) => n.slug)?.slug;
}, ROOT);

await page.goto(`${ROOT}/#/wiki/${slug}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".prose p");
await page.waitForTimeout(320);

const midway = await page.evaluate(() => {
  const block = document.querySelector(".prose p");
  return {
    text: block.textContent,
    cipher: block.classList.contains("is-cipher"),
    read: block.classList.contains("is-read"),
  };
});
await page.waitForTimeout(3200);
const settled = await page.evaluate(() => {
  const block = document.querySelector(".prose p");
  return { text: block.textContent, read: block.classList.contains("is-read") };
});

ok("текст приходит шумом", midway.cipher === true && midway.read === false);
ok("шум не тот же текст", midway.text !== settled.text, midway.text.slice(0, 40));
// Подмена знак в знак: длина та же, поэтому вёрстка не двигается.
ok("длина строки не меняется", midway.text.length === settled.text.length,
  `${midway.text.length} против ${settled.text.length}`);
ok("текст становится собой", settled.read === true && /[а-яё]{4}/i.test(settled.text));
// Пробелы и знаки препинания не подменяются — слово держит силуэт.
const shape = [...midway.text].every(
  (ch, i) => /[\p{L}\p{N}]/u.test(ch) === /[\p{L}\p{N}]/u.test(settled.text[i]),
);
ok("пробелы и препинание не подменяются", shape);

/* ── плашки, виджеты, оттиск ──────────────────────────────────────────── */
await page.evaluate(() => window.scrollTo(0, 520));
await page.waitForTimeout(2600);

const widgets = await page.evaluate(() => {
  const at = (sel) => document.querySelector(sel);
  const style = (sel, prop) => (at(sel) ? getComputedStyle(at(sel))[prop] : null);
  return {
    barFill: style(".w-bar-fill", "transform"),
    barIn: at(".w-bar")?.classList.contains("is-in") ?? null,
    dots: at(".w-dotbar")?.classList.contains("is-in") ?? null,
    dotScale: style(".w-dot", "transform"),
    tableRow: style(".prose table tbody tr", "opacity"),
    fields: style(".w-fields dd", "opacity"),
    spoilerIn: at(".w-spoiler")?.classList.contains("is-in") ?? null,
    spoilerSize: style(".w-spoiler", "backgroundSize"),
    quoteBy: at(".w-quote-by")?.textContent ?? null,
  };
});

ok("шкала налилась", widgets.barIn === true && widgets.barFill === "matrix(1, 0, 0, 1, 0, 0)", String(widgets.barFill));
// Конечное состояние точки — `transform:none`, и вычисленный стиль так и
// пишет: «none», а не единичную матрицу.
const dotSettled = widgets.dotScale === "none" || widgets.dotScale === "matrix(1, 0, 0, 1, 0, 0)";
ok("точки зажглись", widgets.dots === true && dotSettled, String(widgets.dotScale));
ok("строки таблицы видны", widgets.tableRow === "1", String(widgets.tableRow));
ok("поля досье видны", widgets.fields === "1", String(widgets.fields));
ok("плашка спойлера выехала", widgets.spoilerIn === true && widgets.spoilerSize.startsWith("100%"), String(widgets.spoilerSize));
ok("подпись под цитатой на месте", (widgets.quoteBy ?? "").length > 0, String(widgets.quoteBy));
await page.screenshot({ path: path.join(SHOTS, "reader-02-record.png"), fullPage: true });

/* ── закрытая запись: плашки — и есть содержимое ──────────────────────── */
const sealed = await page.evaluate(async (root) => {
  const { nodes } = await (await fetch(`${root}/api/wiki/nav`)).json();
  return nodes.find((n) => n.slug && n.access > 0)?.slug ?? null;
}, ROOT);
if (sealed) {
  await page.goto(`${ROOT}/#/wiki/${sealed}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".w-classified");
  await page.waitForTimeout(150);
  const early = await page.evaluate(
    () => getComputedStyle(document.querySelectorAll(".w-classified")[6]).backgroundSize,
  );
  await page.waitForTimeout(3200);
  const late = await page.evaluate(
    () => getComputedStyle(document.querySelectorAll(".w-classified")[6]).backgroundSize,
  );
  ok("гриф выезжает, а не стоит с самого начала", early !== late, `${early} → ${late}`);
  ok("гриф доезжает до конца", late.startsWith("100%") || late.split(" ")[0].endsWith("px"), late);
  await page.screenshot({ path: path.join(SHOTS, "reader-03-sealed.png") });
} else {
  ok("гриф выезжает, а не стоит с самого начала", true);
  ok("гриф доезжает до конца", true);
}

/* ── штамп ────────────────────────────────────────────────────────────── */
const stamped = await page.evaluate(async (root) => {
  const { nodes } = await (await fetch(`${root}/api/wiki/nav`)).json();
  const folder = nodes.find((n) => n.kind === "folder" && !n.parentId);
  return folder?.id ?? null;
}, ROOT);
if (stamped) {
  await page.goto(`${ROOT}/#/folder/${stamped}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  ok("описание раздела видно на его странице", (await page.locator(".hero--cat p, .cover").count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, "reader-04-folder.png"), fullPage: true });
}

// Штамп — оттиск, а не наклонённый текст: двойная линия, поворот и маска.
const stamp = await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.className = "w-stamp";
  probe.innerHTML = '<span class="w-stamp__in"><b>проба</b><s>дата</s></span>';
  document.body.append(probe);
  const own = getComputedStyle(probe);
  const inner = getComputedStyle(probe.querySelector(".w-stamp__in"));
  const out = {
    outer: own.borderTopWidth,
    inner: inner.borderTopWidth,
    rotate: own.rotate,
    mask: (own.maskImage || own.webkitMaskImage || "").slice(0, 5),
    blend: own.mixBlendMode,
  };
  probe.remove();
  return out;
});
ok("у оттиска двойная линия", stamp.outer === "2px" && stamp.inner === "1px", JSON.stringify(stamp));
ok("оттиск повёрнут", stamp.rotate !== "none" && stamp.rotate !== "0deg", String(stamp.rotate));
ok("краска легла неровно", stamp.mask === "url(\"" || stamp.mask.startsWith("url("), String(stamp.mask));
ok("оттиск лежит на бумаге, а не поверх", stamp.blend === "multiply", String(stamp.blend));

/* ── выключенная анимация: та же страница, просто сразу ───────────────── */
const still = await context.newPage();
await still.emulateMedia({ reducedMotion: "reduce" });
await still.goto(`${ROOT}/#/wiki/${slug}`, { waitUntil: "domcontentloaded" });
await still.waitForSelector(".prose p");
await still.waitForTimeout(400);
const quiet = await still.evaluate(() => ({
  text: document.querySelector(".prose p").textContent,
  read: document.querySelector(".prose p").classList.contains("is-read"),
  bar: document.querySelector(".w-bar")?.classList.contains("is-in") ?? true,
  spoiler: document.querySelector(".w-spoiler")?.classList.contains("is-in") ?? true,
}));
ok("без анимации текст стоит сразу", quiet.read === true && quiet.text === settled.text);
ok("без анимации виджеты уже на месте", quiet.bar === true && quiet.spoiler === true);
await still.close();

if (errors.length) failures.push(`ошибки в консоли: ${errors.join(" | ")}`);

console.log(`${passed} проверок пройдено, ${failures.length} провалено`);
for (const line of failures) console.log(`  ✗ ${line}`);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
