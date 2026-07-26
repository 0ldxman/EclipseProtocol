import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkup } from "../src/index.js";

test("renders plain markdown", () => {
  const { html } = renderMarkup("# Заголовок\n\nОбычный **текст**.");
  assert.match(html, /<h1 id="заголовок">Заголовок<\/h1>/);
  assert.match(html, /<strong>текст<\/strong>/);
});

test("inline widget carries style and content", () => {
  const { html } = renderMarkup(":tag[Пропал без вести]{style=warn}");
  assert.match(html, /class="w-tag is-warn"/);
  assert.match(html, /Пропал без вести/);
});

test("an unknown style falls back to neutral rather than emitting it", () => {
  const { html } = renderMarkup(":tag[X]{style=onfire}");
  assert.match(html, /class="w-tag is-neutral"/);
  assert.doesNotMatch(html, /onfire/);
});

test("commas inside an attribute do not split it - the old parser's worst bug", () => {
  const { html } = renderMarkup(':tag[Мёртв, официально]{style="danger"}');
  assert.match(html, /Мёртв, официально/);
  assert.match(html, /is-danger/);
});

test("widgets nest inside widgets", () => {
  const { html } = renderMarkup(":::infobox\n:tag[Активен]{style=ok}\n:::");
  assert.match(html, /<aside class="w-infobox"/);
  assert.match(html, /w-tag is-ok/);
});

test("infobox is a block in the document, not a separate field", () => {
  const { html } = renderMarkup("Начало.\n\n:::infobox{title=Досье}\nТело\n:::\n\nКонец.");
  assert.match(html, /data-slot="aside"/);
  assert.match(html, /Досье/);
  assert.match(html, /Начало\./);
  assert.match(html, /Конец\./);
});

test("the record page can lift infoboxes into their own column", () => {
  const source = "Начало.\n\n:::infobox{title=Досье}\nТело досье\n:::\n\nКонец.";

  const inline = renderMarkup(source);
  assert.equal(inline.infoboxes.length, 0);
  assert.match(inline.html, /w-infobox/);

  const split = renderMarkup(source, { extractInfoboxes: true });
  assert.equal(split.infoboxes.length, 1);
  assert.match(split.infoboxes[0] ?? "", /Тело досье/);
  assert.doesNotMatch(split.html, /w-infobox/);
  // The body keeps everything else, in order, with no hole left behind.
  assert.match(split.html, /Начало\./);
  assert.match(split.html, /Конец\./);
});

test("an infobox nested in another is not hoisted twice", () => {
  const { infoboxes } = renderMarkup("::::infobox{title=Внешний}\n:::infobox\nВнутри\n:::\n::::", {
    extractInfoboxes: true,
  });
  assert.equal(infoboxes.length, 1);
  assert.match(infoboxes[0] ?? "", /Внутри/);
});

test("a widget with its own chrome still keeps the content inside it", () => {
  // Regression: building the element on the markdown side wrote hChildren,
  // which replaces children wholesale - so an infobox with a title rendered
  // as just the title, silently dropping everything the editor wrote.
  const { html } = renderMarkup(
    ":::infobox{title=Досье}\n" +
      "::image{src=/a.jpg caption=Фото}\n\n" +
      "**Статус:** :tag[Активен]{style=ok}\n\n" +
      "::dotbar{name=Допуск max=5 current=3}\n" +
      ":::",
  );
  assert.match(html, /w-infobox-title">Досье</);
  assert.match(html, /<img src="\/a.jpg"/);
  assert.match(html, /w-tag is-ok">Активен</);
  assert.equal((html.match(/w-dot is-on/g) ?? []).length, 3);
});

test("bar clamps and reports its ratio", () => {
  const { html } = renderMarkup("::bar{name=Готовность max=10 current=15}");
  assert.match(html, /data-ratio="1.000"/);
  assert.match(html, /15\/10/);
});

test("dotbar emits one dot per unit", () => {
  const { html } = renderMarkup("::dotbar{name=Ранг max=5 current=2}");
  assert.equal((html.match(/w-dot is-on/g) ?? []).length, 2);
  assert.equal((html.match(/w-dot is-off/g) ?? []).length, 3);
});

test("image renders a figure with a caption", () => {
  const { html, firstImage } = renderMarkup(
    '::image{src=/media/kremen.jpg caption="Последнее фото"}',
  );
  assert.match(html, /<figure class="w-image is-full">/);
  assert.match(html, /<figcaption>Последнее фото<\/figcaption>/);
  assert.equal(firstImage, "/media/kremen.jpg");
});

test("wiki links resolve to flat slugs, display text first", () => {
  const { html, links } = renderMarkup("См. [[Кремень|kremen]] и [[apollo]].");
  assert.deepEqual(links, ["kremen", "apollo"]);
  assert.match(html, /href="\/wiki\/kremen"[^>]*>Кремень</);
  assert.match(html, /href="\/wiki\/apollo"[^>]*>apollo</);
});

test("unresolved links render marked instead of vanishing", () => {
  const { html, brokenLinks } = renderMarkup("[[Кремень|kremen]] [[ghost]]", {
    linkExists: (slug) => slug === "kremen",
  });
  assert.deepEqual(brokenLinks, ["ghost"]);
  assert.match(html, /class="wikilink is-broken"/);
  assert.match(html, />ghost</);
});

test("an unclosed bracket does not swallow the paragraph", () => {
  const { html, links } = renderMarkup("Текст [[ и дальше обычный текст.");
  assert.deepEqual(links, []);
  assert.match(html, /и дальше обычный текст\./);
});

test("an unknown directive degrades to text and is reported", () => {
  const { html, unknown } = renderMarkup("Было :tagg[Опечатка] и продолжение.");
  assert.deepEqual(unknown, ["tagg"]);
  assert.match(html, /Было :tagg\[Опечатка\] и продолжение\./);
});

test("raw html is stripped", () => {
  const { html } = renderMarkup('<script>alert(1)</script><img src=x onerror="alert(1)">');
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /onerror/);
});

test("headings become a table of contents with stable cyrillic anchors", () => {
  const { headings } = renderMarkup("# Обзор\n\n## Детали\n\n## Обзор");
  assert.deepEqual(headings, [
    { level: 1, id: "обзор", text: "Обзор" },
    { level: 2, id: "детали", text: "Детали" },
    { level: 2, id: "обзор-1", text: "Обзор" },
  ]);
});

test("excerpt takes prose and skips headings and captions", () => {
  const { excerpt } = renderMarkup(
    "# Заголовок\n\nПервый абзац записи.\n\n::image{src=/a.jpg caption=Подпись}",
  );
  assert.equal(excerpt, "Первый абзац записи.");
});

test("gfm tables still work alongside directives", () => {
  const { html } = renderMarkup("| a | b |\n| - | - |\n| 1 | 2 |");
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
});

test("classified renders as a marked span, ready for server-side redaction", () => {
  const { html } = renderMarkup(":classified[отчёт 12-B]{level=3}");
  assert.match(html, /class="w-classified" data-level="3"/);
});
