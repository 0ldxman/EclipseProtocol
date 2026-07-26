/**
 * Скриншот админки: дерево, редактор и правая колонка.
 *
 *   node tools/shot-admin.mjs name [record|folder|props|create]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3010/admin/";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

const [name, mode = "record"] = process.argv.slice(2);

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(ADMIN, { waitUntil: "networkidle" });
await page.waitForSelector(".tree-row");

if (mode === "record" || mode === "props") {
  await page.locator(".tree-row", { hasText: "Кремень" }).first().click();
  await page.waitForSelector(".cm-content");
  await page.waitForTimeout(1500);
}
if (mode === "props") {
  await page.locator('#view-tabs button[data-tab="props"]').click();
  await page.waitForTimeout(300);
}
if (mode === "folder") {
  await page.locator(".tree-row", { hasText: "Операции" }).first().click();
  await page.waitForTimeout(400);
}
if (mode === "create") {
  await page.locator(".tree-row", { hasText: "Операции" }).first().click();
  await page.locator("#new-record").click();
  await page.waitForTimeout(300);
  await page.keyboard.type("Северный Ветер");
  await page.waitForTimeout(200);
}

await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
console.log(`${name}.png`);
if (errors.length) console.log("console errors:\n" + errors.join("\n"));
await browser.close();
