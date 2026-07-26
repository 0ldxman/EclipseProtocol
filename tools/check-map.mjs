/**
 * End-to-end check for the map prototype.
 *
 * Loads the served page in a real browser, waits for the topology to decode and
 * MapLibre to render, then drives the two things the architecture claims:
 * painting a province, and a second tab seeing that paint arrive over the CRDT
 * connection. Screenshots both tabs so the result can be looked at rather than
 * taken on trust.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL_BASE = process.env.MAP_URL ?? "http://localhost:3010/map/";
const SHOTS = new URL("../.dev-screenshots/", import.meta.url).pathname;

const log = (...args) => console.log(...args);

await mkdir(SHOTS, { recursive: true });

// This sandbox has a chromium build already unpacked but not the one the
// installed playwright expects, and its dependency check refuses to run here.
// Point straight at the existing binary instead.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

const errors = [];
const openTab = async (label) => {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  return page;
};

const a = await openTab("A");
await a.goto(URL_BASE, { waitUntil: "networkidle" });

// The status line switches off "загрузка" only once the bundle is decoded.
await a.waitForFunction(
  () => /провинций/.test(document.getElementById("status")?.textContent ?? ""),
  null,
  { timeout: 60_000 },
);
log("A: topology loaded ->", await a.textContent("#status"));

await a.waitForFunction(() => {
  const c = document.querySelector("#map canvas");
  return c instanceof HTMLCanvasElement && c.width > 0;
}, null, { timeout: 30_000 });
await a.waitForTimeout(2500); // let the first render settle
await a.screenshot({ path: `${SHOTS}map-01-loaded.png` });
log("A: rendered");

// Create a country, then paint a few provinces by clicking the canvas.
await a.click("#add-country");
await a.waitForTimeout(300);
const countryName = await a.textContent("#countries .country.active .name");
log("A: created country ->", countryName?.trim());

const box = await a.locator("#map canvas").boundingBox();
const clicks = [
  [0.55, 0.45], [0.57, 0.47], [0.53, 0.49], [0.59, 0.43], [0.51, 0.44],
];
for (const [fx, fy] of clicks) {
  await a.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await a.waitForTimeout(220);
}
await a.waitForTimeout(1200);
await a.screenshot({ path: `${SHOTS}map-02-painted.png` });

const painted = await a.evaluate(() => {
  const el = document.querySelector("#countries .country.active .count");
  return el?.textContent?.trim() ?? "0";
});
const timing = (await a.textContent("#timing"))?.trim();
log("A: provinces painted ->", painted, "|", timing);

// Second tab must receive the same state through the server.
const b = await openTab("B");
await b.goto(URL_BASE, { waitUntil: "networkidle" });
await b.waitForFunction(
  () => /провинций/.test(document.getElementById("status")?.textContent ?? ""),
  null,
  { timeout: 60_000 },
);
await b.waitForFunction(
  (expected) => {
    const rows = [...document.querySelectorAll("#countries .country")];
    return rows.some((r) => r.querySelector(".count")?.textContent?.trim() === expected);
  },
  painted,
  { timeout: 20_000 },
);
await b.waitForTimeout(2500);
await b.screenshot({ path: `${SHOTS}map-03-second-tab.png` });
log("B: received the same ownership over the socket");

// And back the other way: paint in B, observe in A.
const beforeA = await a.textContent("#timing");
const boxB = await b.locator("#map canvas").boundingBox();
await b.click("#add-country");
await b.waitForTimeout(300);
await b.mouse.click(boxB.x + boxB.width * 0.45, boxB.y + boxB.height * 0.55);
await a.waitForFunction(
  (before) => (document.getElementById("timing")?.textContent ?? "") !== before,
  beforeA,
  { timeout: 20_000 },
);
await a.waitForTimeout(1500);
await a.screenshot({ path: `${SHOTS}map-04-back-in-first-tab.png` });
log("A: saw B's paint arrive");

log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
