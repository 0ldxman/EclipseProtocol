/**
 * Скриншоты читательских экранов — чтобы смотреть на вёрстку, а не воображать её.
 *
 *   node tools/shot-wiki.mjs home /            1600x1000
 *   node tools/shot-wiki.mjs cat  /folder/<id> 1920x1200
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE = process.env.SITE_URL ?? "http://127.0.0.1:3010/";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

const [name, route = "/", size = "1600x1000", full = "full"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(SITE.replace(/\/$/, "") + "/#" + route, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full === "full" });
console.log(`${name}.png ${width}x${height}`);
if (errors.length) console.log("console errors:\n" + errors.join("\n"));
await browser.close();
