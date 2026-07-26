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

/* ── виджеты, добавленные вместе с новым оформлением ─────────────────── */

test("a note carries a default title for its style", () => {
  const { html } = renderMarkup(":::note{style=warn}\nТри отчёта не сходятся.\n:::");
  assert.match(html, /class="w-note is-warn"/);
  assert.match(html, /<b>внимание<\/b>/);
  assert.match(html, /Три отчёта не сходятся\./);
});

test("a note keeps an explicit title over the default one", () => {
  const { html } = renderMarkup(':::note{style=danger title="Оспорено стороной"}\nТекст.\n:::');
  assert.match(html, /<b>Оспорено стороной<\/b>/);
});

test("fields become a definition list split on the double colon", () => {
  const { html } = renderMarkup(":::fields\nПозывной :: «Кремень»\nШифр :: AC/*0041\n:::");
  assert.match(html, /class="w-fields"/);
  assert.match(html, /<dt>Позывной<\/dt><dd>«Кремень»<\/dd>/);
  assert.match(html, /<dt>Шифр<\/dt><dd>AC\/\*0041<\/dd>/);
});

test("a line without the separator is skipped rather than becoming an empty row", () => {
  const { html } = renderMarkup(":::fields\nбез разделителя\nШифр :: AC/*0041\n:::");
  assert.doesNotMatch(html, /без разделителя/);
  assert.match(html, /<dt>Шифр<\/dt>/);
});

test("a record card asks the renderer for the title, not the author", () => {
  const { html } = renderMarkup("::record{slug=apollo}", {
    resolveRecord: (slug) =>
      slug === "apollo" ? { title: "Протокол Аполлон", category: "операции" } : null,
  });
  assert.match(html, /class="w-record" href="\/wiki\/apollo"/);
  assert.match(html, /<b>Протокол Аполлон<\/b>/);
  assert.match(html, /операции/);
});

test("an unresolved record card is marked instead of pretending to be a link", () => {
  const { html } = renderMarkup("::record{slug=nowhere}", { resolveRecord: () => null });
  assert.match(html, /w-record is-broken/);
  assert.doesNotMatch(html, /<a class="w-record"/);
});

test("a sealed record card says what it needs rather than showing nothing", () => {
  const { html } = renderMarkup("::record{slug=tihiy-polden}", {
    resolveRecord: () => ({ title: "Тихий Полдень", category: "операции", access: 3 }),
  });
  assert.match(html, /требуется допуск 3/);
  assert.match(html, /◇/);
});

test("video renders a real player, not a picture of one", () => {
  const { html } = renderMarkup("::video{src=/uploads/a.mp4 poster=/uploads/a.jpg caption=Кадр}");
  assert.match(html, /<video[^>]+src="\/uploads\/a\.mp4"/);
  assert.match(html, /poster="\/uploads\/a\.jpg"/);
  assert.match(html, /<figcaption>Кадр<\/figcaption>/);
});

test("a table directive styles the table gfm already parsed", () => {
  const { html } = renderMarkup(
    ':::table{caption="Состав группы"}\n| a | b |\n| - | - |\n| 1 | 2 |\n:::',
  );
  assert.match(html, /class="w-table-wrap"/);
  assert.match(html, /<table class="w-table">/);
  assert.match(html, /Состав группы/);
});

test("a file widget is a download link with its size", () => {
  const { html } = renderMarkup('::file{src=/uploads/r.pdf name="Отчёт 12-Б" size="240 КБ"}');
  assert.match(html, /class="w-file" href="\/uploads\/r\.pdf" download/);
  assert.match(html, /Отчёт 12-Б/);
  assert.match(html, /240 КБ/);
});

/* ── титульный лист ──────────────────────────────────────────────────── */

test("a cover lays the document out as a title leaf", () => {
  const { html } = renderMarkup(
    ':::cover{theme=black-red pattern=rays org="Архивная служба" volume="том IV"}\n' +
      "# Орден Затмения\n\n" +
      ':::epigraph{cite="совет, 2020"}\nМы остались стоять там, где стояли.\n:::\n' +
      ":::\n",
  );
  assert.match(html, /class="cover cover--black-red cover--pat-rays"/);
  assert.match(html, /class="cover__frame"/);
  assert.match(html, /class="cover__mark"/);
  assert.match(html, /том IV/);
  assert.match(html, /<h1 id="орден-затмения">Орден Затмения<\/h1><div class="cover__rule">/);
  assert.match(html, /class="cover__epi"/);
  assert.match(html, /<cite>совет, 2020<\/cite>/);
});

test("an unknown cover theme falls back to the paper leaf rather than emitting itself", () => {
  const { html } = renderMarkup(":::cover{theme=neon}\n# Раздел\n:::");
  assert.match(html, /class="cover cover--pat-fiber"/);
  assert.doesNotMatch(html, /neon/);
});

test("a logo replaces the default mark", () => {
  const { html } = renderMarkup(':::cover{logo=/uploads/emblem.svg org="Орден"}\n# Орден\n:::');
  assert.match(html, /class="cover__mark cover__mark--img"/);
  assert.match(html, /<img src="\/uploads\/emblem\.svg" alt="Орден">/);
});

test("columns move below the rule while the title stays centred", () => {
  const { html } = renderMarkup(
    ":::cover\n# Операции\n\n:::columns\nСвободный текст.\n\n:::right\n" +
      ":::fields\nзаписей :: 9\n:::\n::stamp[для служебного пользования]\n:::\n:::\n:::\n",
  );
  const inner = html.indexOf('class="cover__in"');
  const foot = html.indexOf('class="cover__foot"');
  assert.ok(inner > -1 && foot > inner, "нижние колонки идут после центральной части");
  assert.match(html, /class="cover__imprint"/);
  assert.match(html, /class="cover__stamp">для служебного пользования/);
});

/* ── обычный текст ───────────────────────────────────────────────────────── */

test("a single newline inside a paragraph is a line break, not a space", () => {
  const { html } = renderMarkup("Операция 1\nОперация 2\nОперация 3");
  assert.match(html, /Операция 1<br>\s*Операция 2<br>\s*Операция 3/);
});

test("line-oriented directives keep their newlines as syntax", () => {
  const { html } = renderMarkup(":::fields\nпозывной :: «Кремень»\nстатус :: жив\n:::");
  assert.match(html, /<dt>позывной<\/dt><dd>«Кремень»<\/dd>/);
  assert.match(html, /<dt>статус<\/dt><dd>жив<\/dd>/);
  assert.doesNotMatch(html, /<br>/);
});

test("__underline__ and **bold** are told apart by the source, not the tree", () => {
  const { html } = renderMarkup("__подчёркнуто__ и **полужирно**");
  assert.match(html, /<u>подчёркнуто<\/u>/);
  assert.match(html, /<strong>полужирно<\/strong>/);
});

test("a plain markdown table renders as a table", () => {
  const { html } = renderMarkup("| год | роль |\n| --- | --- |\n| 2029 | ведущий |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>год<\/th>/);
  assert.match(html, /<td>2029<\/td>/);
});

test("::event is a link into the chronology, not the source of one", () => {
  const { html } = renderMarkup('::event{at=2031-04-12 epoch="Разлом"}');
  assert.match(html, /<a class="w-event" href="\/timeline"/);
  assert.match(html, /2031-04-12/);
  assert.match(html, /Разлом/);
});
