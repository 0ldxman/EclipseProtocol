/**
 * Демонстрационный архив: дерево, обложки, записи, события и метки.
 *
 * Нужен для работы над вёрсткой — экран, на котором две записи, врёт о том,
 * как страница выглядит в жизни. Содержимое записей пишется через админку,
 * как это делает человек, поэтому маршрут ровно тот же, что в бою: правка
 * попадает в Y.Doc, сервер её материализует в `.md`.
 *
 *   node tools/seed-demo.mjs
 */
import { chromium } from "playwright";

const SITE = process.env.SITE_URL ?? "http://127.0.0.1:3010";
const ADMIN = `${SITE}/admin/`;

const api = async (route, init = {}) => {
  const headers = init.body ? { "Content-Type": "application/json" } : {};
  const response = await fetch(`${SITE}${route}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route} -> ${response.status}`);
  return payload;
};

const existing = await api("/api/tree");
for (const node of existing.nodes.filter((n) => n.parentId === null)) {
  await api(`/api/tree/nodes/${node.id}`, { method: "DELETE" });
}

const folder = (name, parentId = null) =>
  api("/api/tree/nodes", { method: "POST", body: JSON.stringify({ kind: "folder", name, parentId }) });
const rec = (name, parentId) =>
  api("/api/tree/nodes", { method: "POST", body: JSON.stringify({ kind: "record", name, parentId }) });
const patch = (id, body) =>
  api(`/api/tree/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/**
 * Заглушки под картинки. Кладутся в хранилище тем же маршрутом, что и
 * настоящие вложения, — иначе демо зависело бы от чужого сервера картинок.
 */
const upload = async (svg) => {
  const response = await fetch(`${SITE}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "image/svg+xml" },
    body: svg,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`upload -> ${response.status}`);
  return payload.url;
};

const plate = (w, h, glyph, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#17181b"/>` +
  `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="#2a2c30"/>` +
  `<text x="50%" y="46%" text-anchor="middle" font-family="monospace" font-size="${Math.round(w / 6)}"` +
  ` fill="#3b3d41">${glyph}</text>` +
  `<text x="50%" y="${h - 26}" text-anchor="middle" font-family="monospace" font-size="13"` +
  ` letter-spacing="3" fill="#54565a">${label}</text></svg>`;

const portrait = await upload(plate(420, 560, "◆", "АРХИВ · ФОТО"));
const station = await upload(plate(420, 300, "△", "АРХИВ · СНИМОК"));
const field = await upload(plate(560, 320, "⬡", "АРХИВ · ВЫХОД"));
const camp = await upload(plate(560, 320, "◫", "АРХИВ · ПЛОЩАДКА"));
const device = await upload(plate(480, 320, "⌸", "АРХИВ · ИЗДЕЛИЕ"));

/* ── дерево ────────────────────────────────────────────────────────────── */
const people = await folder("Персонажи");
const ops = await folder("Операции");
const places = await folder("Места");
const orgs = await folder("Организации");
const tech = await folder("Технологии");

const eden = await folder("Новый Эдем", ops.id);
const vault = await folder("Особая папка", ops.id);

const sources = new Map();
const put = async (node, source) => {
  sources.set(node.id, source);
  return node;
};

const mk = async (name, parent, source, extra = {}) => {
  const node = await rec(name, parent.id);
  if (Object.keys(extra).length) await patch(node.id, extra);
  await put(node, source);
  return node;
};

/* ── обложки ───────────────────────────────────────────────────────────── */
const cover = (parent, body) => mk("_cover", parent, body);

await cover(
  ops,
  [
    '::::::cover{theme=black-red pattern=rays org="Архивная служба" volume="том II"}',
    "# Операции",
    "",
    ':::::epigraph{cite="предисловие к сводному тому, 2033"}',
    "Ни одна операция протокола не завершена. Часть закрыта, часть забыта,",
    "остальные продолжаются без нас.",
    ":::::",
    "",
    ":::::columns",
    "Полевые программы, отдельные выходы и всё, что за ними последовало.",
    "Записи раздела ведутся по донесениям групп и сверяются с журналом связи.",
    "",
    "::::right",
    ":::fields",
    "записей :: 9",
    "охват :: 2027—2033",
    "гриф :: частично",
    ":::",
    "",
    "::stamp[для служебного пользования]",
    "::::",
    ":::::",
    "::::::",
  ].join("\n"),
);

await cover(
  eden,
  [
    '::::::cover{theme=orange-black pattern=hatch org="Группа «Новый Эдем»" volume="дело 14"}',
    "# Новый Эдем",
    "",
    ':::::epigraph{cite="радиоперехват, 12.09.2031"}',
    "Сад закрыт. Повторяю: сад закрыт.",
    ":::::",
    "",
    ":::::columns",
    "Программа расселения и то, во что она превратилась к третьему году.",
    "",
    "::::right",
    ":::fields",
    "записей :: 3",
    "статус :: свёрнута",
    ":::",
    "::::",
    ":::::",
    "::::::",
  ].join("\n"),
);

await cover(
  orgs,
  [
    '::::::cover{theme=blue-white pattern=grid org="Реестр сторон" volume="том I"}',
    "# Организации",
    "",
    ":::::columns",
    "Стороны протокола: кто подписывал, кто исполнял и кто остался в стороне.",
    "",
    "::::right",
    ":::fields",
    "записей :: 4",
    "ведётся с :: 2027",
    ":::",
    "::::",
    ":::::",
    "::::::",
  ].join("\n"),
);

await cover(
  people,
  [
    '::::::cover{theme=black-white pattern=fiber org="Личный состав" volume="том III"}',
    "# Персонажи",
    "",
    ':::::epigraph{cite="из служебной записки"}',
    "Люди в этом деле — единственное, что нельзя восстановить по документам.",
    ":::::",
    "",
    ":::::columns",
    "Досье оперативников, аналитиков и тех, кого протокол застал случайно.",
    "",
    "::::right",
    ":::fields",
    "досье :: 6",
    "утрачено :: 2",
    ":::",
    "::::",
    ":::::",
    "::::::",
  ].join("\n"),
);

/* ── записи ────────────────────────────────────────────────────────────── */
await mk(
  "Кремень",
  people,
  [
    "# Кремень",
    "",
    "::::infobox{title=Досье}",
    `::image{src="${portrait}" caption="«Кремень», 2030"}`,
    "",
    ":::fields",
    "позывной :: «Кремень»",
    "статус :: пропал без вести",
    "род войск :: разведка",
    "последний контакт :: 12.04.2031",
    ":::",
    "",
    "::dotbar{name=Допуск max=5 current=3}",
    "",
    "::bar{name=Достоверность max=100 current=62}",
    "",
    ":tag[Пропал без вести]{style=warn} :tag[Разлом]{style=ghost}",
    "::::",
    "",
    "::event{at=2031-04-12 epoch=\"Разлом\"}",
    "",
    "Оперативник полевой группы, участник [[Протокол Аполлон|apollo]]. Последний",
    "человек, видевший станцию [[Мыс Тишина|cape]] до её закрытия.",
    "",
    "## Биография",
    "",
    "Родился в промышленном поясе. Служил в разведке, вербован после операции",
    "«Северный Ветер» — по представлению [[Отдел «Восход»|voskhod]].",
    "",
    ":::note{style=info}",
    "Личное дело до 2029 года изъято и в архив не передавалось.",
    ":::",
    "",
    "### Ранние годы",
    "",
    "Ничего примечательного, кроме результатов стрелковой подготовки: три года",
    "подряд первое место по округу.",
    "",
    "## Операции",
    "",
    "| год | операция | роль |",
    "| --- | --- | --- |",
    "| 2029 | Аполлон | ведущий группы |",
    "| 2030 | Новый Эдем | наблюдатель |",
    "| 2031 | Тихий Полдень | — |",
    "",
    "Последний контакт — :timestamp[12.04.2031 09:00]{at=2031-04-12T09:00:00Z}.",
    "",
    ":::quote{by=\"«Кремень», последняя радиограмма\"}",
    "Если через шесть часов молчание — считайте, что сада не было.",
    ":::",
    "",
    "## Статус",
    "",
    "Пропал без вести; поиски прекращены решением коллегии в 2032 году.",
  ].join("\n"),
  { slug: "kremen", tags: ["оперативники", "разлом", "пропавшие"] },
);

await mk(
  "Сова",
  people,
  [
    "# Сова",
    "",
    "::::infobox{title=Досье}",
    ":::fields",
    "позывной :: «Сова»",
    "статус :: в строю",
    "специальность :: связь",
    ":::",
    "",
    "::dotbar{name=Допуск max=5 current=4}",
    "",
    ":tag[В строю]{style=ok}",
    "::::",
    "",
    "::event{at=2029-08-02 epoch=\"Восхождение\"}",
    "",
    "Связист группы. Единственная, кто вёл журнал связи вручную — благодаря чему",
    "хронология [[Протокол Аполлон|apollo]] вообще восстановима.",
    "",
    "## Журнал",
    "",
    "Записи велись карандашом, в двух экземплярах. Второй экземпляр не найден.",
  ].join("\n"),
  { slug: "sova", tags: ["оперативники", "связь"] },
);

await mk(
  "Аналитик Вейн",
  people,
  [
    "# Аналитик Вейн",
    "",
    "::::infobox{title=Досье}",
    ":::fields",
    "должность :: старший аналитик",
    "отдел :: «Восход»",
    "статус :: в отставке",
    ":::",
    "::::",
    "",
    "::event{at=2033-01-19 epoch=\"Пепел\"}",
    "",
    "Автор сводного тома, из которого собран этот архив.",
    "",
    "## Позиция",
    "",
    "Настаивал, что протокол следовало остановить после [[Тихий Полдень|noon]].",
  ].join("\n"),
  { slug: "vein", tags: ["аналитики"] },
);

await mk(
  "Протокол Аполлон",
  ops,
  [
    "# Протокол Аполлон",
    "",
    "::::infobox{title=Операция}",
    ":::fields",
    "начало :: 02.08.2029",
    "конец :: 14.11.2029",
    "исход :: частичный успех",
    "потери :: 4",
    ":::",
    "",
    "::bar{name=Выполнено max=100 current=71}",
    "",
    ":tag[Закрыта]{style=ghost}",
    "::::",
    "",
    "::event{at=2029-08-02 epoch=\"Восхождение\"}",
    "",
    `::image{src="${field}" caption="Высадка группы, август 2029"}`,
    "",
    "Совместная операция трёх сторон. Участвовали [[Кремень|kremen]] и",
    "[[Сова|sova]]; координация — [[Отдел «Восход»|voskhod]].",
    "",
    "## Замысел",
    "",
    "Вывести оборудование станции [[Мыс Тишина|cape]] до наступления зимы.",
    "",
    ":::note{style=warn}",
    "Сроки были сорваны на девять недель. Причина в документах не указана.",
    ":::",
    "",
    "## Ход",
    "",
    "1. Высадка группы, 02.08.",
    "2. Развёртывание связи, 05.08.",
    "3. Потеря связи с южным постом, 21.09.",
    "4. Свёртывание, 14.11.",
    "",
    "## Итог",
    "",
    "Оборудование вывезено на две трети; остальное осталось на месте и позже",
    "вошло в опись [[Новый Эдем|eden-op]].",
  ].join("\n"),
  { slug: "apollo", tags: ["операции", "восхождение"] },
);

await mk(
  "Новый Эдем",
  eden,
  [
    "# Новый Эдем",
    "",
    "::::infobox{title=Программа}",
    ":::fields",
    "запущена :: 03.2030",
    "свёрнута :: 09.2031",
    "поселений :: 6",
    ":::",
    "::::",
    "",
    "::event{at=2030-03-11 epoch=\"Разлом\"}",
    "",
    `::image{src="${camp}" caption="Вторая площадка, 2030"}`,
    "",
    "Программа расселения. Шесть площадок, из которых заселены четыре.",
    "",
    "## Площадки",
    "",
    "| номер | место | статус |",
    "| --- | --- | --- |",
    "| 1 | Мыс Тишина | законсервирована |",
    "| 2 | Северный склон | заселена |",
    "| 3 | Излучина | заселена |",
    "| 4 | Сад | утрачена |",
  ].join("\n"),
  { slug: "eden-op", tags: ["операции", "расселение", "разлом"] },
);

await mk(
  "Сад",
  eden,
  [
    "# Сад",
    "",
    "::event{at=2031-09-12 epoch=\"Разлом\"}",
    "",
    "Четвёртая площадка программы. Связь прервана 12.09.2031 и не восстановлена.",
    "",
    ":::quote{by=\"радиоперехват\"}",
    "Сад закрыт. Повторяю: сад закрыт.",
    ":::",
  ].join("\n"),
  { slug: "sad", tags: ["расселение", "разлом"] },
);

await mk(
  "Тихий Полдень",
  vault,
  [
    "# Тихий Полдень",
    "",
    "::event{at=2031-06-03 epoch=\"Разлом\"}",
    "",
    "Кодовое слово операции — саркофаг. Дальнейшее изложение закрыто.",
    "",
    "## Обстоятельства",
    "",
    "Материалы третьего допуска.",
  ].join("\n"),
  { slug: "noon", tags: ["операции"] },
);

await mk(
  "Мыс Тишина",
  places,
  [
    "# Мыс Тишина",
    "",
    "::::infobox{title=Объект}",
    `::image{src="${station}" caption="Станция, 2029"}`,
    "",
    ":::fields",
    "тип :: станция",
    "введён :: 2027",
    "статус :: законсервирован",
    ":::",
    "::::",
    "",
    "::event{at=2027-05-30 epoch=\"Восхождение\"}",
    "",
    "Первая станция протокола. Отсюда начинались [[Протокол Аполлон|apollo]] и",
    "программа [[Новый Эдем|eden-op]].",
    "",
    "## Устройство",
    "",
    "Три корпуса, причал и вышка связи. Вышка разобрана в 2032 году.",
  ].join("\n"),
  { slug: "cape", tags: ["места", "восхождение"] },
);

await mk(
  "Излучина",
  places,
  [
    "# Излучина",
    "",
    "Третья площадка [[Новый Эдем|eden-op]]. Единственная, где люди остались.",
  ].join("\n"),
  { slug: "izluchina", tags: ["места", "расселение"] },
);

await mk(
  "Отдел «Восход»",
  orgs,
  [
    "# Отдел «Восход»",
    "",
    "::::infobox{title=Организация}",
    ":::fields",
    "основан :: 2026",
    "подчинение :: коллегия",
    "штат :: 40+",
    ":::",
    "",
    ":tag[Действует]{style=ok}",
    "::::",
    "",
    "::event{at=2026-11-04 epoch=\"Восхождение\"}",
    "",
    "Координирующий отдел протокола. Через него шли все допуски.",
  ].join("\n"),
  { slug: "voskhod", tags: ["организации"] },
);

await mk(
  "Коллегия",
  orgs,
  [
    "# Коллегия",
    "",
    "::event{at=2032-02-08 epoch=\"Пепел\"}",
    "",
    "Орган, закрывший поиски по делу [[Кремень|kremen]].",
  ].join("\n"),
  { slug: "kollegia", tags: ["организации"] },
);

await mk(
  "Изделие 7",
  tech,
  [
    "# Изделие 7",
    "",
    "::::infobox{title=Изделие}",
    ":::fields",
    "индекс :: 7",
    "назначение :: связь",
    "выпущено :: 12",
    ":::",
    "",
    "::bar{name=Надёжность max=100 current=38}",
    "",
    ":tag[Снято с довольствия]{style=danger}",
    "::::",
    "",
    "::event{at=2028-06-15 epoch=\"Восхождение\"}",
    "",
    `::image{src="${device}" caption="Изделие 7 на испытаниях"}`,
    "",
    "Передатчик дальней связи. Из двенадцати изделий работоспособны два.",
  ].join("\n"),
  { slug: "izdelie-7", tags: ["техника"] },
);

await mk(
  "Журнал связи",
  tech,
  ["# Журнал связи", "", "Тетрадь [[Сова|sova]]. Основной источник хронологии."].join("\n"),
  { slug: "log", tags: ["техника", "источники"] },
);

/* ── содержимое через админку ──────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: "/config/.cache/ms-playwright/chromium-1228/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const editor = await context.newPage();
await editor.goto(ADMIN, { waitUntil: "networkidle" });
await editor.waitForFunction(() => document.querySelectorAll(".tree-row").length > 10, null, {
  timeout: 30_000,
});

for (const [id, source] of sources) {
  await editor.locator(`.tree-row[data-id="${id}"]`).first().click();
  await editor.waitForSelector(".cm-content", { timeout: 20_000 });
  await editor.waitForTimeout(500);
  await editor.evaluate((value) => window.__setSource(value), source);
  await editor.waitForTimeout(700);
  process.stdout.write(".");
}
console.log("");

await patch(vault.id, { accessLevel: 3 });
await editor.waitForTimeout(3500);
await browser.close();

const tree = await api("/api/tree");
console.log(
  `дерево: ${tree.nodes.filter((n) => n.kind === "folder").length} папок · ` +
    `${tree.nodes.filter((n) => n.kind === "record").length} записей`,
);
