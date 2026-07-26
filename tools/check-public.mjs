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

const SITE = process.env.SITE_URL ?? "http://localhost:3010/";
const ADMIN = process.env.ADMIN_URL ?? "http://localhost:3010/admin/";
const API = process.env.API_URL ?? "http://localhost:3010";
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
await editor.waitForFunction(() => document.querySelectorAll(".tree-row").length >= 5, null, {
  timeout: 30_000,
});

const write = async (title, source) => {
  await editor.locator(".tree-row", { hasText: title }).first().click();
  await editor.waitForSelector(".cm-content", { timeout: 20_000 });
  await editor.waitForTimeout(700);
  await editor.evaluate((value) => window.__setSource(value), source);
  await editor.waitForTimeout(900);
};

await write(
  "Кремень",
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
  "Протокол Аполлон",
  ["# Протокол Аполлон", "", "Совместная операция. Участвовал [[Кремень|kremen]]."].join("\n"),
);

await write(
  "Тихий Полдень",
  ["# Тихий Полдень", "", "Кодовое слово операции — саркофаг."].join("\n"),
);

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

// --- the reader's screens -------------------------------------------------
const site = track(await context.newPage(), "site");
await site.goto(SITE, { waitUntil: "networkidle" });
await site.waitForSelector(".entry-list", { timeout: 20_000 });
ok("front page lists categories", (await site.locator(".home-tree .entry").count()) >= 2);
ok("front page shows the archive summary", (await site.locator(".home-stats .row").count()) === 4);
await site.screenshot({ path: path.join(SHOTS, "public-01-home.png") });

// Search palette, by keyboard, exactly as a reader would.
await site.keyboard.press("Control+k");
await site.waitForSelector(".palette-overlay:not([hidden])", { timeout: 10_000 });
await site.keyboard.type("Кремень");
await site.waitForSelector(".palette-row", { timeout: 10_000 });
await site.screenshot({ path: path.join(SHOTS, "public-02-search.png") });
await site.keyboard.press("Enter");

await site.waitForSelector(".record-layout", { timeout: 20_000 });
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
    article: rect(".record"),
    aside: rect(".record-aside"),
    dots: document.querySelectorAll(".toc-dot").length,
    asideInfobox: document.querySelectorAll(".record-aside .w-infobox").length,
    bodyInfobox: document.querySelectorAll(".record-body .w-infobox").length,
    headingIds: [...document.querySelectorAll(".record-body h2")].map((h) => h.id),
    backlinks: [...document.querySelectorAll(".backlink-list a")].map((a) => a.textContent),
  };
});

ok("anchor rail is left of the article", layout.toc.right <= layout.article.left, `${layout.toc.right} <= ${layout.article.left}`);
ok("infobox column is right of the article", layout.aside.left >= layout.article.right, `${layout.aside.left} >= ${layout.article.right}`);
ok("infobox is in the column, not in the text", layout.asideInfobox === 1 && layout.bodyInfobox === 0);
ok("rail has one anchor per top-level heading", layout.dots >= 3, `${layout.dots} anchors`);
ok("headings carry anchors", layout.headingIds.every((id) => id.length > 0));
ok("backlink to the other record is shown", layout.backlinks.length === 1, layout.backlinks.join(", "));
await site.screenshot({ path: path.join(SHOTS, "public-03-record.png") });

// Scroll-spy: the active anchor must follow the reading position.
const firstActive = await site.evaluate(
  () => document.querySelectorAll(".toc-dot polygon[opacity='1']").length,
);
await site.evaluate(() => document.getElementById("статус")?.scrollIntoView());
await site.waitForTimeout(600);
const movedActive = await site.evaluate(() => {
  const dots = [...document.querySelectorAll(".toc-dot")];
  return dots.findIndex((dot) => dot.querySelector("polygon[opacity='1']"));
});
ok("scroll-spy marks an anchor", firstActive >= 1 && movedActive >= 0, `index ${movedActive}`);

// A wiki link inside the rendered record navigates without a reload.
await site.locator(".record-body a.wikilink").first().click();
await site.waitForFunction(() => location.hash.includes("/wiki/apollo"), null, { timeout: 10_000 });
await site.waitForSelector(".record-title", { timeout: 10_000 });
ok("wiki link navigates in-app", (await site.textContent(".record-title")) === "Протокол Аполлон");

// --- the classified screen -------------------------------------------------
await site.evaluate((slug) => (location.hash = `/wiki/${slug}`), noon.slug);
await site.waitForSelector(".classified", { timeout: 10_000 });
const leak = await site.evaluate(() => document.body.innerHTML.includes("саркофаг"));
ok("classified page contains no trace of the text", leak === false);
ok("classified page still names the record", (await site.textContent(".record-title")) === "Тихий Полдень");
await site.screenshot({ path: path.join(SHOTS, "public-04-classified.png") });

// --- a pasted path-form deep link still lands ------------------------------
const deep = track(await context.newPage(), "deep");
await deep.goto(`${SITE}wiki/kremen`, { waitUntil: "networkidle" });
await deep.waitForSelector(".record-title", { timeout: 20_000 });
ok("path-form deep link resolves", (await deep.textContent(".record-title")) === "Кремень");

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
