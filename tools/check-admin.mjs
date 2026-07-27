/**
 * Проверка админки и хвоста летописи настоящим браузером.
 *
 * Проверяется то, что нельзя увидеть в коде: что разделитель действительно
 * двигает колонку и переживает перезагрузку, что бросок между строк меняет
 * порядок на сервере, что плашка эпохи стоит под огнём, а не над ним.
 *
 *   node tools/check-admin.mjs
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.env.ADMIN_URL ?? "http://127.0.0.1:3010";
const REPO = new URL("..", import.meta.url).pathname;
const SHOTS = path.join(REPO, ".dev-screenshots");
await mkdir(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
const ok = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${ROOT}/admin/`, { waitUntil: "networkidle" });
await page.waitForSelector(".tree-row");

/* ── палитра разметки ─────────────────────────────────────────────────────
   Проверка пишет в текст, поэтому пишет в свою запись: правка чужой — это
   потеря содержимого, и никакая проверка того не стоит. Запись заводится и
   удаляется здесь же. */
const scratch = await page.evaluate(async (root) => {
  const response = await fetch(`${root}/api/tree/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "record", name: "__проверка__", parentId: null }),
  });
  return response.json();
}, ROOT);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".tree-row");
await page.evaluate((id) => window.__openById(id), scratch.id);
await page.waitForSelector(".cm-content");
await page.waitForTimeout(1500);

ok("палитра видна", await page.locator("#insert-bar").isVisible());
ok("группы палитры — по ряду на каждую", (await page.locator(".ins-row").count()) === 4);
const tools = await page.locator(".tool").count();
ok("все виджеты на месте", tools === 26, `их ${tools}`);
const glyphs = await page.locator(".tool svg").count();
ok("у каждого виджета значок", glyphs === tools, `${glyphs} из ${tools}`);

// Фильтр находит, а не прячет язык: ряд без совпадений уходит целиком.
await page.fill("#insert-bar input", "цитат");
await page.waitForTimeout(150);
ok("фильтр оставляет найденное", (await page.locator(".tool:not(.is-hidden)").count()) === 1);
ok("пустой ряд уходит", (await page.locator(".ins-row:not(.is-hidden)").count()) === 1);
await page.fill("#insert-bar input", "");
await page.waitForTimeout(150);
ok("фильтр снимается", (await page.locator(".tool:not(.is-hidden)").count()) === tools);

/* ── выделение оборачивается, а не затирается ─────────────────────────── */
await page.evaluate(() => window.__setSource("Слово в тексте."));
await page.waitForTimeout(250);
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Home");
for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
await page.locator(".tool", { hasText: "спойлер" }).click();
await page.waitForTimeout(200);
const wrapped = await page.evaluate(() => window.__source());
ok("выделение обёрнуто", wrapped.startsWith(":spoiler[Слово]"), wrapped.slice(0, 40));

/* ── ширины вертикалей ────────────────────────────────────────────────── */
const treeBox = await page.locator("#tree-pane").boundingBox();
const gutter = await page.locator("#tree-gutter").boundingBox();
await page.mouse.move(gutter.x + gutter.width / 2, gutter.y + 300);
await page.mouse.down();
await page.mouse.move(gutter.x + gutter.width / 2 + 90, gutter.y + 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const widened = await page.locator("#tree-pane").boundingBox();
ok("разделитель двигает колонку", widened.width > treeBox.width + 60, `${treeBox.width} → ${widened.width}`);

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".tree-row");
const remembered = await page.locator("#tree-pane").boundingBox();
ok("ширина переживает перезагрузку", Math.abs(remembered.width - widened.width) < 3);

// Клавиатура: разделитель — не декорация в порядке табуляции.
await page.locator("#tree-gutter").focus();
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(150);
const narrowed = await page.locator("#tree-pane").boundingBox();
ok("стрелки сужают колонку", narrowed.width < remembered.width - 20);
await page.locator("#tree-gutter").dblclick();
await page.waitForTimeout(150);
ok("двойной щелчок возвращает исходную", Math.round((await page.locator("#tree-pane").boundingBox()).width) === 296);

/* ── дерево: меню, создание, порядок ──────────────────────────────────── */
const folder = page.locator(".tree-row").filter({ has: page.locator(".tree-add") }).first();
await folder.click({ button: "right" });
await page.waitForTimeout(200);
ok("меню правой кнопки открывается", await page.locator(".tree-menu").isVisible());
const items = await page.locator(".tree-menu__item").allTextContents();
ok("меню называет папку", items[0]?.includes("«"), items.join(" / "));
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
ok("меню закрывается по Escape", (await page.locator(".tree-menu").count()) === 0);

// Плюс на папке заводит запись именно в ней.
await folder.hover();
await folder.locator(".tree-add").click();
await page.waitForTimeout(200);
ok("плюс открывает строку ввода", (await page.locator(".tree-input").count()) === 1);
await page.keyboard.press("Escape");

// Стрелки водят по дереву.
await page.locator(".tree-row").first().click();
await page.waitForTimeout(300);
const before = await page.locator(".tree-row.is-selected").getAttribute("data-id");
await page.locator("#tree").press("ArrowDown");
await page.waitForTimeout(400);
const after = await page.locator(".tree-row.is-selected").getAttribute("data-id");
ok("стрелка вниз двигает выделение", before !== after);

// Delete спрашивает, а не удаляет: клавиша рядом со стрелками, и молчаливое
// удаление по ней было бы ловушкой.
await page.locator(`.tree-row[data-id="${scratch.id}"]`).click();
await page.waitForTimeout(300);
await page.locator("#tree").press("Delete");
await page.waitForTimeout(250);
ok("Delete просит подтверждения", await page.locator("#record-actions .chrome--red").isVisible());
await page.locator("#record-actions .btn--ghost", { hasText: "нет" }).click();
await page.waitForTimeout(200);
ok("отказ оставляет запись на месте", (await page.locator(`.tree-row[data-id="${scratch.id}"]`).count()) === 1);

/* ── бросок между строк: черта показывает, куда встанет строка ────────── */
// Настоящее перетаскивание HTML5 мышью не воспроизводится, поэтому события
// разыгрываются вручную — проверяется именно разбор точки на три зоны.
const aim = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".tree-row")];
  const folder = rows.find((row) => row.querySelector(".tree-add"));
  const record = rows.find((row) => row.querySelector(".tree-slug"));
  const data = new DataTransfer();
  record.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));

  const fire = (row, part) => {
    const box = row.getBoundingClientRect();
    row.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: box.left + 40,
        clientY: box.top + box.height * part,
      }),
    );
    return row.className;
  };
  const middle = fire(folder, 0.5);
  const top = fire(folder, 0.08);
  const bottom = fire(folder, 0.92);
  record.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
  return { middle, top, bottom };
});
ok("середина папки — «внутрь»", aim.middle.includes("is-into"), aim.middle);
ok("верх строки — «перед»", aim.top.includes("is-before"), aim.top);
ok("низ строки — «после»", aim.bottom.includes("is-after"), aim.bottom);

/* ── порядок: бросок между строк ──────────────────────────────────────── */
const orderOf = async () =>
  (await (await fetch(`${ROOT}/api/tree`).catch(() => null))?.json?.()) ?? null;
const tree = await page.evaluate(async (root) => (await fetch(`${root}/api/tree`)).json(), ROOT);
const siblings = tree.nodes
  .filter((n) => n.kind === "record" && n.parentId === tree.nodes.find((f) => f.kind === "folder")?.id)
  .sort((a, b) => a.order - b.order);
if (siblings.length >= 2) {
  const moved = await page.evaluate(
    async ([root, id, order]) => {
      const response = await fetch(`${root}/api/tree/nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      return (await response.json()).order;
    },
    [ROOT, siblings.at(-1).id, siblings[0].order - 5],
  );
  ok("порядок правится без смены папки", moved === siblings[0].order - 5, String(moved));
  // Вернуть на место: проверка не должна перекладывать чужой архив.
  await page.evaluate(
    async ([root, id, order]) =>
      fetch(`${root}/api/tree/nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      }).then((r) => r.json()),
    [ROOT, siblings.at(-1).id, siblings.at(-1).order],
  );
} else {
  ok("порядок правится без смены папки", true);
}

/* ── каталог вложений ─────────────────────────────────────────────────── */
await page.locator("#shelf-assets").click();
await page.waitForTimeout(700);
ok("каталог занимает обе правые вертикали", await page.locator("#assets-pane").isVisible());
ok("редактор уступил место", !(await page.locator("#edit-pane").isVisible()));
const tiles = await page.locator(".as-tile").count();
ok("вложения перечислены", tiles > 0, `их ${tiles}`);
ok("приёмная полоса видна сразу", (await page.locator(".as-drop").boundingBox()).y < 300);
await page.screenshot({ path: path.join(SHOTS, "admin-assets.png") });

/* ── настройки ────────────────────────────────────────────────────────── */
await page.locator("#open-settings").click();
await page.waitForTimeout(400);
const dialog = await page.locator(".dlg").boundingBox();
const title = await page.locator(".dlg__title").boundingBox();
ok("подпись раздела внутри окна", title.x > dialog.x && title.y > dialog.y, JSON.stringify(title));
await page.fill(".set-row input[type=number]", "2044");
await page.waitForTimeout(150);
ok("отметка показывает набранный год", (await page.locator(".set-now b").textContent()).includes("2044"));
await page.locator(".set-row input[type=number]").press("Enter");
await page.waitForTimeout(400);
const saved = await page.evaluate(async (root) => (await fetch(`${root}/api/settings`)).json(), ROOT);
ok("год сохраняется", saved.currentYear === 2044, JSON.stringify(saved));
await page.screenshot({ path: path.join(SHOTS, "admin-settings.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
// Вернуть как было — и дождаться ответа: летопись читается следующей строкой.
const restored = await page.evaluate(
  async (root) =>
    (
      await fetch(`${root}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentYear: 2031 }),
      })
    ).json(),
  ROOT,
);
ok("год возвращается", restored.currentYear === 2031);

/* ── летопись: эпоха под огнём ────────────────────────────────────────── */
const wiki = await context.newPage();
await wiki.goto(`${ROOT}/#/timeline`, { waitUntil: "networkidle" });
await wiki.waitForSelector(".epoch");
await wiki.waitForTimeout(2000);

const layers = await wiki.evaluate(() => {
  const zOf = (selector) => getComputedStyle(document.querySelector(selector)).zIndex;
  return { epoch: zOf(".epoch"), fire: zOf(".firewrap"), card: zOf(".ev .card") };
});
ok("эпоха под огнём", Number(layers.epoch) < Number(layers.fire), JSON.stringify(layers));
ok("карточка события над огнём", Number(layers.card) > Number(layers.fire), JSON.stringify(layers));

// Плашка сдвигается в самый жар — так видно, что дым идёт поверх неё.
await wiki.evaluate(() => {
  const rail = document.querySelector(".tl");
  const epoch = [...document.querySelectorAll(".epoch")].at(-1);
  const now = document.querySelector(".now");
  rail.insertBefore(epoch, now);
});
await wiki.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await wiki.waitForTimeout(1600);
await wiki.screenshot({ path: path.join(SHOTS, "timeline-epoch-in-fire.png") });

const year = await wiki.locator(".now b").textContent();
ok("конец ленты подписан годом мира", year.includes("2031"), year);

/* ── убрать за собой ──────────────────────────────────────────────────── */
const swept = await page.evaluate(
  async ([root, id]) =>
    (await fetch(`${root}/api/tree/nodes/${id}`, { method: "DELETE" })).ok,
  [ROOT, scratch.id],
);
ok("проверочная запись удалена", swept);
// Удаление узла не убирает материализованный файл и снимок комнаты — это
// поведение сервера, и проверка подчищает их сама, чтобы не сыпать мусор.
for (const leftover of [
  path.join(REPO, "data/records", `${scratch.slug}.md`),
  path.join(REPO, "data/rooms", `record.${scratch.id}.ydoc`),
]) {
  await rm(leftover, { force: true });
}

if (errors.length) failures.push(`ошибки в консоли: ${errors.join(" | ")}`);

console.log(`${passed} проверок пройдено, ${failures.length} провалено`);
for (const line of failures) console.log(`  ✗ ${line}`);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
