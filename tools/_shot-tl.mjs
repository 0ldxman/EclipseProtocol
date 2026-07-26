import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
await page.goto("file:///config/workspace/aether/.claude/references/AetherWiki/Eclipse Protocol Timeline.html", { waitUntil: "load" });
await page.waitForTimeout(2500);
const dir = "/tmp/claude-1000/-config-workspace-aether/6f26f9ab-1706-4072-b521-e5ff310cbf48/scratchpad";
await page.screenshot({ path: `${dir}/tl-1.png` });
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/tl-2.png` });
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/tl-3.png` });
console.log("height", await page.evaluate(() => document.body.scrollHeight));
await browser.close();
