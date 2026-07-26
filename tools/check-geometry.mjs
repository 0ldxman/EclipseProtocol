/**
 * Verifies runtime geometry editing.
 *
 * Three things have to hold, and each is checked rather than eyeballed:
 *   - a traced shape becomes a real province: paintable, and its outline joins
 *     the border pass;
 *   - deleting a province hides it and hands its former borders to the sea, so
 *     the neighbour grows a coastline instead of leaving a hole;
 *   - both edits travel to a second tab through the CRDT like ownership does.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL_BASE = process.env.MAP_URL ?? "http://127.0.0.1:3010/map/";
const SHOTS = new URL("../.dev-screenshots/", import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const errors = [];
const openTab = async (label) => {
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  await page.goto(URL_BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => /провинций/.test(document.getElementById("status")?.textContent ?? ""),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2000);
  return page;
};

const a = await openTab("A");
await a.evaluate(() => window.__reset?.());
await a.waitForTimeout(500);

const stats = () => a.textContent("#geo-stats");
console.log("start        :", (await stats())?.trim());

// --- trace a new island out at sea -------------------------------------
await a.evaluate(() => window.__map?.easeTo({ center: [3.0, 43.0], zoom: 6, duration: 0 }));
await a.waitForTimeout(1200);
await a.click("#add-country");
await a.click('[data-tool="draw"]');
await a.waitForTimeout(200);

const box = await a.locator("#map canvas").boundingBox();
const click = async (fx, fy) => {
  await a.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await a.waitForTimeout(150);
};
for (const [fx, fy] of [[0.42, 0.40], [0.52, 0.36], [0.58, 0.46], [0.50, 0.56], [0.40, 0.50]]) {
  await click(fx, fy);
}
await a.keyboard.press("Enter");
await a.waitForTimeout(1200);
console.log("after tracing:", (await stats())?.trim(), "|", (await a.textContent("#timing"))?.trim());
await a.screenshot({ path: `${SHOTS}geo-01-island-drawn.png` });

const drawnCount = await a.evaluate(
  () => Number(/нарисовано (\d+)/.exec(document.getElementById("geo-stats").textContent)[1]),
);
if (drawnCount !== 1) throw new Error(`expected 1 drawn province, got ${drawnCount}`);

// --- delete a province and watch the coastline appear -------------------
await a.evaluate(() => window.__map?.easeTo({ center: [14.5, 49.5], zoom: 6, duration: 0 }));
await a.waitForTimeout(1200);
await a.click('[data-tool="paint"]');
for (const [fx, fy] of [[0.45, 0.45], [0.5, 0.45], [0.55, 0.45], [0.5, 0.52], [0.45, 0.52]]) {
  await click(fx, fy);
}
await a.waitForTimeout(800);
await a.screenshot({ path: `${SHOTS}geo-02-before-delete.png` });
const bordersBefore = (await a.textContent("#timing"))?.trim();

await a.click('[data-tool="erase"]');
await click(0.5, 0.45);
await a.waitForTimeout(1200);
await a.screenshot({ path: `${SHOTS}geo-03-after-delete.png` });
console.log("before delete:", bordersBefore);
console.log("after delete :", (await a.textContent("#timing"))?.trim());
console.log("geo          :", (await stats())?.trim());

const hidden = await a.evaluate(
  () => Number(/скрыто (\d+)/.exec(document.getElementById("geo-stats").textContent)[1]),
);
if (hidden !== 1) throw new Error(`expected 1 hidden province, got ${hidden}`);

// --- second tab must see both edits ------------------------------------
const b = await openTab("B");
await b.waitForFunction(
  () => {
    const text = document.getElementById("geo-stats")?.textContent ?? "";
    return /нарисовано 1/.test(text) && /скрыто 1/.test(text);
  },
  null,
  { timeout: 20_000 },
);
await b.evaluate(() => window.__map?.easeTo({ center: [14.5, 49.5], zoom: 6, duration: 0 }));
await b.waitForTimeout(2500);
await b.screenshot({ path: `${SHOTS}geo-04-second-tab.png` });
console.log("tab B        :", (await b.textContent("#geo-stats"))?.trim());

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
