import { chromium } from "playwright";
const [name, lng, lat, zoom] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.goto(process.env.SHOT_URL ?? "http://127.0.0.1:3010/map/", { waitUntil: "networkidle" });
await page.waitForFunction(() => /провинций/.test(document.getElementById("status")?.textContent ?? ""), null, { timeout: 60000 });
await page.evaluate(() => window.__reset?.());
await page.waitForTimeout(600);
await page.evaluate(([x, y, z]) => window.__map.easeTo({ center: [x, y], zoom: z, duration: 0 }),
  [Number(lng), Number(lat), Number(zoom)]);
await page.waitForTimeout(3000);
await page.screenshot({ path: `.dev-screenshots/${name}.png` });
await browser.close();
