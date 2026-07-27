/**
 * Verifies the public wiki: the reader's screens, and the promise that a record
 * above your clearance is not merely hidden by CSS.
 *
 * Three claims are load-bearing here:
 *
 *   1. the record screen has the shape the design specifies - anchor rail on
 *      the left, article in the middle, infobox in its own column - and the
 *      infobox is really out of the body, not floated inside it;
 *   2. a restricted record's text never leaves the server, so the API response
 *      itself must be empty, not just the page;
 *   3. search finds a record by a word in its body, and by title alone when the
 *      body is one the reader cannot read.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE = process.env.SITE_URL ?? "http://127.0.0.1:3010/";
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3010/admin/";
const API = process.env.API_URL ?? "http://127.0.0.1:3010";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

const api = async (route, init = {}) => {
  const headers = init.body ? { "Content-Type": "application/json" } : {};
  const response = await fetch(`${API}${route}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  // Strict on purpose: a fixture that half-builds itself produces failures far
  // away from the mistake that caused them.
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${route} -> ${response.status} ${payload.message ?? payload.error ?? ""}`,
    );
  }
  return payload;
};

const ok = (label, condition, detail = "") => {
  if (!condition) throw new Error(`${label} failed ${detail}`);
  console.log(`ok: ${label}${detail ? ` (${detail})` : ""}`);
};

// --- a clean tree, then the fixture --------------------------------------
const existing = await api("/api/tree");
for (const node of existing.nodes.filter((n) => n.parentId === null)) {
  await api(`/api/tree/nodes/${node.id}`, { method: "DELETE" });
}

const mkFolder = (name, parentId = null) =>
  api("/api/tree/nodes", { method: "POST", body: JSON.stringify({ kind: "folder", name, parentId }) });
const mkRecord = (name, parentId) =>
  api("/api/tree/nodes", { method: "POST", body: JSON.stringify({ kind: "record", name, parentId }) });

const people = await mkFolder("Персонажи");
const ops = await mkFolder("Операции");
const vault = await mkFolder("Особая папка", ops.id);

const kremen = await mkRecord("Кремень", people.id);
const apollo = await mkRecord("Протокол Аполлон", ops.id);
const noon = await mkRecord("Тихий Полдень", vault.id);
// Обложка категории — обычная запись с этим именем внутри папки.
const cover = await mkRecord("_cover", ops.id);
await api(`/api/tree/nodes/${apollo.id}`, { method: "PATCH", body: JSON.stringify({ slug: "apollo" }) });

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });

const errors = [];
const track = (page, label) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  return page;
};

// --- write the records through the admin ---------------------------------
const editor = track(await context.newPage(), "admin");
await editor.goto(ADMIN, { waitUntil: "networkidle" });
await editor.waitForFunction(() => document.querySelectorAll(".tree-row").length >= 7, null, {
  timeout: 30_000,
});

// Строка адресуется по идентификатору, а не по подписи: обложка выводится
// в дереве как «титульный лист», и поиск по тексту искал бы не то.
const write = async (node, source) => {
  await editor.locator(`.tree-row[data-id="${node.id}"]`).first().click();
  await editor.waitForSelector(".cm-content", { timeout: 20_000 });
  await editor.waitForTimeout(700);
  await editor.evaluate((value) => window.__setSource(value), source);
  await editor.waitForTimeout(900);
};

await write(
  kremen,
  [
    "# Кремень",
    "",
    ":::infobox{title=Досье}",
    "**Позывной:** «Кремень»",
    "",
    "**Статус:** :tag[Пропал без вести]{style=warn}",
    "",
    "::dotbar{name=Допуск max=5 current=3}",
    ":::",
    "",
    "::event{at=2031-04-12 epoch=\"Разлом\"}",
    "",
    "Оперативник, участник [[Протокол Аполлон|apollo]].",
    "",
    "## Биография",
    "",
    "Родился в промышленном поясе. Служил в разведке, вербован после операции",
    "«Северный Ветер».",
    "",
    "### Ранние годы",
    "",
    "Ничего примечательного, кроме результатов стрелковой подготовки.",
    "",
    "## Операции",
    "",
    "Последний контакт — :timestamp[2031-04-12T09:00:00Z]{at=2031-04-12T09:00:00Z}.",
    "",
    "## Статус",
    "",
    "Пропал без вести; поиски прекращены.",
  ].join("\n"),
);

await write(
  apollo,
  [
    "# Протокол Аполлон",
    "",
    "::event{at=2029-08-02 epoch=\"Восхождение\"}",
    "",
    "Совместная операция. Участвовал [[Кремень|kremen]].",
  ].join("\n"),
);

// Титульный лист категории. Внешний контейнер обязан иметь больше двоеточий,
// чем вложенный, иначе забор закрывает не то, что нужно.
await write(
  cover,
  [
    '::::::cover{theme=black-red pattern=rays org="Архивная служба" volume="том II"}',
    "# Операции",
    "",
    ':::::epigraph{cite="предисловие, 2033"}',
    "Ни одна операция протокола не завершена.",
    ":::::",
    "",
    ":::::columns",
    "Полевые программы и отдельные выходы.",
    "",
    "::::right",
    ":::fields",
    "записей :: 2",
    "охват :: 2029—2031",
    ":::",
    "",
    "::stamp[для служебного пользования]",
    "::::",
    ":::::",
    "::::::",
  ].join("\n"),
);

await write(
  noon,
  [
    "# Тихий Полдень",
    "",
    // Событие закрытой записи: в ленте оно есть, содержания в нём нет.
    "::event{at=2031-06-03 epoch=\"Разлом\"}",
    "",
    "Кодовое слово операции — саркофаг.",
  ].join("\n"),
);

// Место в летописи — свойство записи, а не строчка в её теле; подпись и
// снимок карточки тоже. У «Аполлона» эпохи нет намеренно: события до первой
// названной эпохи в ленте есть, а плашки не заводят.
const setEvent = (node, patch) =>
  api(`/api/tree/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify(patch) });

// Снимок кладётся настоящим файлом: выдуманный путь дал бы 404 в консоли
// читателя, а консоль здесь тоже под проверкой.
const upload = await fetch(`${API}/api/uploads`, {
  method: "POST",
  headers: { "Content-Type": "image/svg+xml" },
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#17181b"/></svg>',
}).then((r) => r.json());

await setEvent(kremen, {
  eventAt: "2031-04-12",
  eventEpoch: "Разлом",
  eventSummary: "Последний сеанс связи с группой.",
  eventImage: upload.url,
});
await setEvent(apollo, { eventAt: "2029-08-02", eventEpoch: "" });
await setEvent(noon, {
  eventAt: "2031-06-03",
  eventEpoch: "Разлом",
  eventSummary: "Кодовое слово операции — саркофаг.",
  eventImage: upload.url,
});

// Clearance goes on the folder and is inherited downwards.
await api(`/api/tree/nodes/${vault.id}`, { method: "PATCH", body: JSON.stringify({ accessLevel: 3 }) });
await editor.waitForTimeout(3200); // debounced materialisation feeds the index

// --- the API must not hand out what the reader is not cleared for --------
const secret = await api(`/api/wiki/records/${noon.slug}`);
ok("restricted record is marked restricted", secret.restricted === true, `access ${secret.access}`);
ok("restricted body never leaves the server", secret.html === "" && secret.infoboxes.length === 0);
const open = await api(`/api/wiki/records/${kremen.slug}`);
ok("open record still renders", open.html.length > 100 && open.restricted === false);
ok("infobox comes out of the body", open.infoboxes.length === 1 && !open.html.includes("w-infobox"));
ok("backlinks are resolved", open.backlinks.some((b) => b.slug === "apollo"));

const bodySearch = await api("/api/wiki/search?q=разведк");
ok("search finds a word in the body", bodySearch.results.some((r) => r.slug === "kremen"));
const secretSearch = await api("/api/wiki/search?q=саркофаг");
ok("restricted bodies are not searched", secretSearch.results.length === 0);
const titleSearch = await api("/api/wiki/search?q=Тихий");
ok(
  "a restricted record is still findable by title",
  titleSearch.results.some((r) => r.slug === noon.slug && r.restricted === true),
);

// Карточку летописи собирают свойства записи, а не её текст. У закрытой
// записи не уходит ничего: подпись и снимок закрыты тем же грифом, что и тело.
const chronologyApi = await api("/api/wiki/timeline");
const sealedEvent = chronologyApi.events.find((e) => e.slug === noon.slug);
ok(
  "a sealed event carries neither summary nor picture",
  sealedEvent?.restricted === true && sealedEvent.summary === "" && sealedEvent.image === "",
);
const openEvent = chronologyApi.events.find((e) => e.slug === kremen.slug);
ok(
  "a card's caption and picture come from the record's properties",
  openEvent?.summary === "Последний сеанс связи с группой." && openEvent.image === upload.url,
  `подпись: ${openEvent?.summary ?? "—"}`,
);
ok(
  "an event without a caption gets none invented for it",
  chronologyApi.events.find((e) => e.slug === "apollo")?.summary === "",
);
ok(
  "an event without an epoch does not invent one",
  chronologyApi.events.some((e) => e.slug === "apollo" && e.epoch === "") &&
    chronologyApi.epochs.every((e) => e.name !== ""),
  `эпох: ${chronologyApi.epochs.map((e) => e.name).join(", ")}`,
);

// --- the reader's screens -------------------------------------------------
const site = track(await context.newPage(), "site");
await site.goto(SITE, { waitUntil: "networkidle" });
await site.waitForSelector(".folder", { timeout: 20_000 });
ok("front page lays categories out as folder tabs", (await site.locator(".folder").count()) >= 2);
ok("front page shows the change feed", (await site.locator(".feed a").count()) >= 1);
ok("front page offers the other entrances", (await site.locator(".gate a").count()) >= 2);
await site.screenshot({ path: path.join(SHOTS, "public-01-home.png") });

// Командная строка — с клавиатуры, ровно как ею пользуется читатель.
await site.keyboard.press("Control+k");
await site.waitForSelector(".pal[open]", { timeout: 10_000 });
await site.keyboard.type("Кремень");
// Поиск по телу идёт на сервер и приходит позже локальных совпадений —
// ждём именно результат, а не первую отрисовку списка.
await site.waitForFunction(
  () => document.querySelector(".pal__prev h4")?.textContent === "Кремень",
  null,
  { timeout: 10_000 },
);
ok("the palette previews the highlighted hit", true);
await site.screenshot({ path: path.join(SHOTS, "public-02-search.png") });
await site.keyboard.press("Enter");

await site.waitForSelector(".paper", { timeout: 20_000 });
await site.waitForTimeout(400);

const layout = await site.evaluate(() => {
  const rect = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) };
  };
  return {
    toc: rect(".toc"),
    paper: rect(".paper"),
    aside: rect(".aside"),
    dots: document.querySelectorAll(".toc li").length,
    asideInfobox: document.querySelectorAll(".aside .w-infobox").length,
    bodyInfobox: document.querySelectorAll(".paper .w-infobox").length,
    headingIds: [...document.querySelectorAll(".paper .prose h2")].map((h) => h.id),
    backlinks: [...document.querySelectorAll(".aside .kv a")].map((a) => a.textContent),
    paperBg: getComputedStyle(document.querySelector(".paper")).backgroundColor,
  };
});

ok("anchor rail is left of the document", layout.toc.right <= layout.paper.left, `${layout.toc.right} <= ${layout.paper.left}`);
ok("the column of panels is right of the document", layout.aside.left >= layout.paper.right, `${layout.aside.left} >= ${layout.paper.right}`);
ok("infobox is in the column, not in the text", layout.asideInfobox === 1 && layout.bodyInfobox === 0);
ok("the document is paper, not instrument", layout.paperBg === "rgb(233, 231, 225)", layout.paperBg);
ok("rail has one anchor per heading", layout.dots >= 3, `${layout.dots} anchors`);
ok("headings carry anchors", layout.headingIds.every((id) => id.length > 0));
ok("backlink to the other record is shown", layout.backlinks.length >= 1, layout.backlinks.join(", "));
await site.screenshot({ path: path.join(SHOTS, "public-03-record.png") });

// Слежение за прокруткой: подпись рельса должна идти за читателем.
// Окно намеренно низкое — на высоком окне короткая запись помещается целиком,
// прокрутки нет, и проверка не проверяла бы ничего.
const tall = site.viewportSize();
await site.setViewportSize({ width: tall.width, height: 380 });
await site.waitForTimeout(200);
const firstLabel = await site.textContent(".toc li.on span");
await site.evaluate(() => document.getElementById("статус")?.scrollIntoView());
await site.waitForTimeout(700);
const movedLabel = await site.textContent(".toc li.on span");
await site.setViewportSize(tall);
ok("scroll-spy follows the reading position", movedLabel !== firstLabel, `${firstLabel} -> ${movedLabel}`);

// Ссылка внутри записи ведёт по вики без перезагрузки.
await site.locator(".paper .prose a.wikilink").first().click();
await site.waitForFunction(() => location.hash.includes("/wiki/apollo"), null, { timeout: 10_000 });
await site.waitForSelector(".rec", { timeout: 10_000 });
ok("wiki link navigates in-app", (await site.textContent(".rec")) === "Протокол Аполлон");

// --- принадлежность и титульный лист ---------------------------------------
ok("the record shows the cover it belongs to", (await site.locator(".belong b").count()) === 1);
await site.locator(".belong").click();
await site.waitForSelector(".cover", { timeout: 10_000 });
ok("the category opens with its title leaf", (await site.locator(".cover h1").textContent()) === "Операции");
ok("the leaf carries its imprint and stamp", (await site.locator(".cover .w-stamp").count()) === 1);
await site.screenshot({ path: path.join(SHOTS, "public-05-cover.png") });

// --- хронология ------------------------------------------------------------
await site.evaluate(() => (location.hash = "/timeline"));
await site.waitForSelector(".tl .ev", { timeout: 10_000 });
const chronology = await site.evaluate(() => ({
  events: document.querySelectorAll(".tl .ev").length,
  epochs: document.querySelectorAll(".tl .epoch").length,
  fire: !!document.querySelector("#tl-fire")?.getContext,
  sealed: document.querySelectorAll(".ev--sealed").length,
}));
ok("the chronology is built from the records themselves", chronology.events >= 3, `${chronology.events} events`);
ok("events are grouped into epochs", chronology.epochs >= 1);
ok("the fire is a canvas at the end of the page", chronology.fire === true);
ok("a sealed event is marked but still listed", chronology.sealed >= 1);
// Подпись живёт внутри карточки, а отвод с ромбом приходится на её середину:
// раньше подпись висела под карточкой и открывалась по наведению, а карточка
// стояла на своей высоте и уезжала выше собственной линии.
const card = await site.evaluate(() => {
  const row = [...document.querySelectorAll(".tl .ev:not(.ev--sealed)")].find((e) =>
    e.querySelector(".extra"),
  );
  if (!row) return null;
  const box = row.querySelector(".card").getBoundingClientRect();
  const caption = row.querySelector(".extra");
  const text = caption.getBoundingClientRect();
  const dot = row.querySelector(".node").getBoundingClientRect();
  return {
    inside: text.top >= box.top && text.bottom <= box.bottom + 1,
    shown: text.height > 0 && getComputedStyle(caption).opacity === "1",
    offset: Math.abs(dot.top + dot.height / 2 - (box.top + box.height / 2)),
  };
});
ok("the caption is inside the card and always visible", card?.inside === true && card.shown === true);
ok("the node meets the middle of its card", card.offset <= 2, `${card.offset.toFixed(1)}px`);

// Лента — второй путь, которым тело закрытой записи могло бы утечь наружу.
const timelineLeak = await site.evaluate(() => document.body.innerHTML.includes("саркофаг"));
ok("the chronology carries no trace of a sealed body", timelineLeak === false);
await site.screenshot({ path: path.join(SHOTS, "public-06-timeline.png") });

// --- запись выше допуска ---------------------------------------------------
await site.evaluate((slug) => (location.hash = `/wiki/${slug}`), noon.slug);
await site.waitForSelector(".w-note.is-danger", { timeout: 10_000 });
const leak = await site.evaluate(() => document.body.innerHTML.includes("саркофаг"));
ok("classified page contains no trace of the text", leak === false);
ok("classified page still names the record", (await site.textContent(".rec")) === "Тихий Полдень");
ok("classified page says how much is withheld", (await site.locator(".aside .kv").count()) >= 1);
await site.screenshot({ path: path.join(SHOTS, "public-04-classified.png") });

// --- вставленная ссылка в path-форме всё ещё приземляется --------------------
const deep = track(await context.newPage(), "deep");
await deep.goto(`${SITE}wiki/kremen`, { waitUntil: "networkidle" });
await deep.waitForSelector(".rec", { timeout: 20_000 });
ok("path-form deep link resolves", (await deep.textContent(".rec")) === "Кремень");

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
