/**
 * Verifies the wiki admin: tree, collaborative editing, preview, and the
 * promise that a record is a real markdown file on disk.
 *
 * The load-bearing claims here are that two editors share the *source text*
 * rather than a rich-text model, and that reorganising the tree does not
 * disturb a record's identity - so a link to it keeps working wherever it is
 * dragged.
 */

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const URL_BASE = process.env.ADMIN_URL ?? "http://127.0.0.1:3010/admin/";
const API_BASE = process.env.API_URL ?? "http://127.0.0.1:3010";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

const api = async (route, init = {}) => {
  // Only declare a JSON body when there is one: Fastify rejects a request that
  // announces application/json and then sends nothing, which silently turned
  // every cleanup DELETE into a 400.
  const headers = init.body ? { "Content-Type": "application/json" } : {};
  const response = await fetch(`${API_BASE}${route}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload.error) {
    throw new Error(`${init.method ?? "GET"} ${route} -> ${response.status}`);
  }
  return payload;
};

// Start from a clean tree so the run is repeatable.
const existing = await api("/api/tree");
for (const node of existing.nodes.filter((n) => n.parentId === null)) {
  await api(`/api/tree/nodes/${node.id}`, { method: "DELETE" });
}

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });

const errors = [];
const openTab = async (label) => {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.on("dialog", (d) => d.accept(d.defaultValue() || "ok"));
  await page.goto(URL_BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /записей/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 30_000 });
  return page;
};

const a = await openTab("A");
console.log("A: loaded ->", (await a.textContent("#status"))?.trim());

// --- build a small tree through the API, then check the UI shows it ------
const folder = await api("/api/tree/nodes", {
  method: "POST",
  body: JSON.stringify({ kind: "folder", name: "Персонажи" }),
});
const nested = await api("/api/tree/nodes", {
  method: "POST",
  body: JSON.stringify({ kind: "folder", name: "Аполлон", parentId: folder.id }),
});
const record = await api("/api/tree/nodes", {
  method: "POST",
  body: JSON.stringify({ kind: "record", name: "Кремень", parentId: nested.id }),
});
console.log("tree: record slug ->", record.slug);
if (record.slug !== "kremen") throw new Error(`expected slug "kremen", got "${record.slug}"`);

await a.reload({ waitUntil: "networkidle" });
await a.waitForFunction(() => document.querySelectorAll(".tree-row").length >= 3, null, { timeout: 20_000 });
console.log("A: tree rows ->", await a.locator(".tree-row").count());

// --- open the record and type into it ------------------------------------
await a.locator(".tree-row", { hasText: "Кремень" }).click();
await a.waitForSelector(".cm-content", { timeout: 20_000 });
await a.waitForTimeout(1200);

const source = [
  "# Кремень",
  "",
  ":::infobox{title=Досье}",
  "**Статус:** :tag[Пропал без вести]{style=warn}",
  "",
  "::dotbar{name=Допуск max=5 current=3}",
  ":::",
  "",
  "Оперативник [[Протокол Аполлон|apollo]], пропал во время операции",
  ":classified[«Тихий Полдень»]{level=3}. Смотри также :tagg[опечатка].",
].join("\n");
await a.evaluate((value) => window.__setSource(value), source);
await a.waitForTimeout(1500);

const previewHtml = await a.innerHTML("#preview");
for (const [what, pattern] of [
  ["infobox", /w-infobox/],
  ["tag", /w-tag is-warn/],
  ["dotbar dots", /w-dot is-on/],
  ["classified", /w-classified/],
]) {
  if (!pattern.test(previewHtml)) throw new Error(`preview is missing ${what}`);
}
console.log("A: preview rendered widgets");

const chips = await a.locator("#warnings .chip").allTextContents();
console.log("A: editor warnings ->", chips.join(" | "));
if (!chips.some((c) => c.includes("tagg"))) throw new Error("typo directive was not reported");
if (!chips.some((c) => c.includes("apollo"))) throw new Error("broken link was not reported");

await a.screenshot({ path: path.join(SHOTS, "wiki-01-editor.png") });

// --- second editor in the same record ------------------------------------
const b = await openTab("B");
await b.locator(".tree-row", { hasText: "Кремень" }).click();
await b.waitForSelector(".cm-content", { timeout: 20_000 });
await b.waitForFunction(
  () => (window.__source() ?? "").includes("Кремень"),
  null,
  { timeout: 20_000 },
);
console.log("B: received the document");

await b.locator(".cm-content").click();
await b.keyboard.press("Control+End");
await b.keyboard.type("\n\nДописано из второй вкладки.");
await a.waitForFunction(
  () => (window.__source() ?? "").includes("Дописано из второй вкладки"),
  null,
  { timeout: 20_000 },
);
console.log("A: saw B's typing arrive in the same source text");
await a.waitForTimeout(800);
await a.screenshot({ path: path.join(SHOTS, "wiki-02-collab.png") });

// --- the record must exist on disk as markdown ---------------------------
await a.waitForTimeout(3000); // debounced materialisation
const onDisk = await readFile(path.join(REPO, "data/records", `${record.slug}.md`), "utf8");
if (!onDisk.includes("Дописано из второй вкладки")) {
  throw new Error("markdown file on disk does not contain the collaborative edit");
}
console.log("disk: data/records/kremen.md contains both editors' text");

// --- moving a record must not change its identity ------------------------
const moved = await api(`/api/tree/nodes/${record.id}`, {
  method: "PATCH",
  body: JSON.stringify({ parentId: folder.id }),
});
if (moved.slug !== record.slug) throw new Error("moving a record changed its slug");
console.log("move: record relocated, slug unchanged ->", moved.slug);

// --- and the cycle guard must hold ---------------------------------------
const cycle = await api(`/api/tree/nodes/${folder.id}`, {
  method: "PATCH",
  body: JSON.stringify({ parentId: nested.id }),
});
if (!cycle.error) throw new Error("moving a folder into its own child was allowed");
console.log("guard: folder into own descendant ->", cycle.error);

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
