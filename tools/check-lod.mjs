/**
 * Check that detail actually follows the zoom.
 *
 * The bug this guards against is invisible to any assertion about the data: the
 * bundles always had four levels, the client just used the coarsest one at
 * every zoom, and the map looked fine until you leaned in. So the check drives
 * a real camera and asserts on what the client is holding at each stop -
 * the base level, the number of refined arcs, and the vertex count the map is
 * drawing from - then screenshots it so the result can be looked at too.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL_BASE = process.env.MAP_URL ?? "http://127.0.0.1:3010/map/";
const SHOTS = new URL("../.dev-screenshots/", import.meta.url).pathname;

// Durrës on the Albanian coast: a coastline, an inland border and a scale where
// lod3's 2.2 km tolerance is unmissable.
const [LNG, LAT] = [19.661, 41.428];

// Kept clear of the level boundaries (lod3 runs out at z5.1, lod2 at z7.1,
// lod1 at z10.5) so the expectations are not a coin flip on rounding.
const STOPS = [
  { zoom: 4, expectBase: "lod3", expectRefined: false, name: "lod-z4-overview" },
  { zoom: 6, expectBase: "lod2", expectRefined: false, name: "lod-z6-regional" },
  { zoom: 9, expectBase: "lod2", expectRefined: true, name: "lod-z9-local" },
  { zoom: 12, expectBase: "lod2", expectRefined: true, name: "lod-z12-close" },
];

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL_BASE, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => /провинций/.test(document.getElementById("status")?.textContent ?? ""),
  null,
  { timeout: 60_000 },
);
await page.evaluate(() => window.__reset?.());

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

/** Wait for the controller to settle: it debounces, then may fetch. */
const settle = async () => {
  let last = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const now = JSON.stringify(await page.evaluate(() => window.__lod()));
    if (now === last) return JSON.parse(now);
    last = now;
  }
  return JSON.parse(last);
};

let previousVertices = 0;
for (const stop of STOPS) {
  await page.evaluate(
    ([x, y, z]) => window.__map.easeTo({ center: [x, y], zoom: z, duration: 0 }),
    [LNG, LAT, stop.zoom],
  );
  const state = await settle();
  await page.screenshot({ path: `${SHOTS}${stop.name}.png` });

  console.log(
    `z${stop.zoom}: base=${state.base} target=${state.target} ` +
      `refined=${state.refinedArcs} провинций в детали=${state.detailedProvinces} ` +
      `вершин=${state.vertices.toLocaleString("ru")}` +
      (state.baseSwapMs ? ` (пересборка базы ${state.baseSwapMs} мс)` : ""),
  );
  check(state.base === stop.expectBase, `z${stop.zoom}: base level is ${stop.expectBase}`);
  check(
    stop.expectRefined ? state.refinedArcs > 0 : state.refinedArcs === 0,
    `z${stop.zoom}: viewport refinement ${stop.expectRefined ? "active" : "not needed"}`,
  );
  if (stop.expectRefined) {
    check(state.detailedProvinces > 0, `z${stop.zoom}: refined provinces are drawn`);
  }
  check(
    state.vertices > previousVertices,
    `z${stop.zoom}: more geometry than at the previous stop ` +
      `(${state.vertices.toLocaleString("ru")} > ${previousVertices.toLocaleString("ru")})`,
  );
  previousVertices = state.vertices;
}

// Zooming back out must not throw the fine geometry away and re-fetch it, and
// must not leave the detail overlay drawing over a coarser base.
await page.evaluate(
  ([x, y]) => window.__map.easeTo({ center: [x, y], zoom: 5, duration: 0 }),
  [LNG, LAT],
);
const out = await settle();
check(out.base === "lod2", "zooming back out keeps the finer base");

// Painting still works with a province in the detail overlay. Ownership colour
// lives in feature-state, and feature-state is per source - so a province that
// moved into the detail overlay needs its colour written there too, or it
// paints in the base source that is filtered out from under it and nothing
// visibly happens.
await page.evaluate(
  ([x, y]) => window.__map.easeTo({ center: [x, y], zoom: 11, duration: 0 }),
  [LNG, LAT],
);
await settle();
await page.click("#add-country");
await page.mouse.click(700, 450);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}lod-painted-detail.png` });

const painted = await page.evaluate(() => {
  const map = window.__map;
  const hits = map.queryRenderedFeatures(
    { x: 700, y: 450 },
    { layers: ["detail-fill", "province-fill"] },
  );
  const feature = hits[0];
  if (!feature) return null;
  return {
    layer: feature.layer.id,
    color: map.getFeatureState({ source: feature.source, id: feature.id })?.color ?? null,
  };
});
check(painted !== null, "a province is under the cursor at z11");
check(painted?.layer === "detail-fill", `the province drawn there is refined (${painted?.layer})`);
check(
  typeof painted?.color === "string" && painted.color.startsWith("#"),
  `the refined province carries an ownership colour (${painted?.color})`,
);

/**
 * Panning at a refined zoom must stay cheap.
 *
 * The trap here is the coastline: 23 000 arcs, and the naive version rebuilt
 * all of them every time a refinement landed, which is every pan. It is fixed
 * by filtering the whole-world layer rather than reuploading it, and this is
 * what keeps it fixed.
 */
await page.evaluate(() => {
  window.__long = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    window.__long = null; // not supported here; the check is skipped
  }
});
for (let i = 1; i <= 5; i++) {
  await page.evaluate(
    ([x, y]) => window.__map.easeTo({ center: [x, y], zoom: 10, duration: 0 }),
    [LNG + i * 0.12, LAT + i * 0.05],
  );
  await page.waitForTimeout(1800);
}
const longTasks = await page.evaluate(() => window.__long);
if (longTasks === null) {
  console.log("  skip  long-task timing is unavailable in this browser");
} else {
  const worst = longTasks.length ? Math.max(...longTasks) : 0;
  console.log(`  five pans at z10: ${longTasks.length} long tasks, worst ${worst} ms`);
  // Generous, because this runs on a software rasteriser; a coastline rebuild
  // per pan lands far above it.
  check(worst < 400, `no pan blocks the main thread for long (worst ${worst} ms)`);
}

check(errors.length === 0, `no console errors${errors.length ? `: ${errors[0]}` : ""}`);

await browser.close();

console.log();
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all LOD checks passed");
