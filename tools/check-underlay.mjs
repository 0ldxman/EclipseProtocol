/**
 * Verifies reference underlays end to end.
 *
 * Generates a small image in the page, uploads it through the real endpoint,
 * checks it becomes a corner-pinned layer, drags one corner and confirms the
 * new placement reaches a second tab - placement is shared, visibility is not.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL_BASE = process.env.MAP_URL ?? "http://localhost:3010/map/";
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

// A recognisable test image, drawn in-page so no fixture file is needed.
const png = await a.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffcc33";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#8b1a1a";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  return canvas.toDataURL("image/png");
});

await a.setInputFiles("#underlay-file", {
  name: "reference.png",
  mimeType: "image/png",
  buffer: Buffer.from(png.split(",")[1], "base64"),
});
await a.waitForFunction(
  () => document.querySelectorAll("#underlays .underlay").length === 1,
  null,
  { timeout: 20_000 },
);
await a.waitForTimeout(2000);
console.log("A: uploaded ->", (await a.textContent("#hover"))?.trim());

const layerPresent = await a.evaluate(() =>
  window.__map.getStyle().layers.some((l) => l.id.startsWith("underlay:")),
);
if (!layerPresent) throw new Error("underlay layer was not added to the style");

const handles = await a.locator(".corner-handle").count();
console.log("A: corner handles ->", handles);
if (handles !== 4) throw new Error(`expected 4 corner handles, got ${handles}`);

await a.screenshot({ path: `${SHOTS}underlay-01-placed.png` });

// Drag the top-left corner and check the shared placement changes.
const before = await a.evaluate(() => {
  const [id] = [...window.__map.getStyle().layers]
    .filter((l) => l.id.startsWith("underlay:"))
    .map((l) => l.id);
  return JSON.stringify(window.__map.getSource(id).coordinates);
});

const handle = a.locator(".corner-handle").first();
const hb = await handle.boundingBox();
await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await a.mouse.down();
await a.mouse.move(hb.x - 180, hb.y - 110, { steps: 12 });
await a.mouse.up();
await a.waitForTimeout(1500);

const after = await a.evaluate(() => {
  const [id] = [...window.__map.getStyle().layers]
    .filter((l) => l.id.startsWith("underlay:"))
    .map((l) => l.id);
  return JSON.stringify(window.__map.getSource(id).coordinates);
});
if (before === after) throw new Error("dragging a corner did not move the underlay");
console.log("A: corner dragged, placement changed");
await a.screenshot({ path: `${SHOTS}underlay-02-dragged.png` });

// Second tab: placement must arrive; visibility stays local.
const b = await openTab("B");
await b.waitForFunction(
  () => document.querySelectorAll("#underlays .underlay").length === 1,
  null,
  { timeout: 20_000 },
);
await b.waitForTimeout(2000);
// Compare the shared document, not the rendered source: during a drag the
// source is updated locally for smoothness ahead of the commit, so reading it
// would compare a live preview against a synced value.
const readDoc = (page) => page.evaluate(() => window.__underlays());

// Give the update a moment to travel; compare against A live rather than a
// snapshot, so a late repaint in A does not read as a mismatch in B.
let bCoords = "";
let aCoords = "";
for (let attempt = 0; attempt < 20; attempt++) {
  aCoords = await readDoc(a);
  bCoords = await readDoc(b);
  if (aCoords === bCoords) break;
  await b.waitForTimeout(400);
}
console.log("B: placement matches A ->", aCoords === bCoords);
if (aCoords !== bCoords) {
  console.log("  A:", aCoords);
  console.log("  B:", bCoords);
  throw new Error("second tab did not receive the dragged placement");
}
await b.screenshot({ path: `${SHOTS}underlay-03-second-tab.png` });

// Hiding in B must not hide in A.
await b.locator("#underlays .icon").first().click();
await b.waitForTimeout(800);
const aStillVisible = await a.evaluate(() => {
  const [id] = [...window.__map.getStyle().layers]
    .filter((l) => l.id.startsWith("underlay:"))
    .map((l) => l.id);
  return window.__map.getLayoutProperty(id, "visibility") !== "none";
});
console.log("A: still visible after B hid it ->", aStillVisible);
if (!aStillVisible) throw new Error("visibility leaked between users");

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exitCode = 1;
