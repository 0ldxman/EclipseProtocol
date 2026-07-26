/**
 * Visual proof of the border model.
 *
 * Paints two contiguous blocks of provinces into two different countries and
 * screenshots the result. What should be visible:
 *   - no line between provinces of the same country - internal boundaries
 *     vanish because both sides resolve to the same controller;
 *   - a single outline around each country;
 *   - a front line exactly where the two blocks meet.
 *
 * None of that is computed or stored anywhere - it falls out of filtering arcs
 * by "different controller on each side", which is why it stays instant.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL_BASE = process.env.MAP_URL ?? "http://127.0.0.1:3010/";
const SHOTS = new URL("../.dev-screenshots/", import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newContext({ viewport: { width: 1400, height: 900 } }).then((c) => c.newPage());

await page.goto(URL_BASE, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => /провинций/.test(document.getElementById("status")?.textContent ?? ""),
  null,
  { timeout: 60_000 },
);
await page.waitForTimeout(2500);

// Start from a clean slate so repeated runs are comparable.
await page.evaluate(() => {
  const w = window;
  w.__reset?.();
});

const box = await page.locator("#map canvas").boundingBox();
const click = async (fx, fy) => {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(120);
};

// Country 1: a solid block west of centre.
await page.click("#add-country");
await page.waitForTimeout(200);
for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 4; j++) {
    await click(0.46 + i * 0.018, 0.40 + j * 0.028);
  }
}

// Country 2: the block immediately east of it, so they share a front.
await page.click("#add-country");
await page.waitForTimeout(200);
for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 4; j++) {
    await click(0.556 + i * 0.018, 0.40 + j * 0.028);
  }
}

await page.waitForTimeout(1500);
console.log("timing:", (await page.textContent("#timing"))?.trim());
const counts = await page.evaluate(() =>
  [...document.querySelectorAll("#countries .country")].map((r) => ({
    name: r.querySelector(".name")?.textContent?.trim(),
    count: r.querySelector(".count")?.textContent?.trim(),
  })),
);
console.log("countries:", JSON.stringify(counts, null, 1));

await page.screenshot({ path: `${SHOTS}borders-01-overview.png` });

// Zoom into the shared front so the merged interior is unambiguous.
await page.evaluate(() => window.__map?.easeTo({ center: [14.5, 49.5], zoom: 6, duration: 0 }));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}borders-02-front-closeup.png` });

await browser.close();
