/**
 * Палитра разметки.
 *
 * Язык виджетов иначе невидим: человек, открывший пустую запись, не может
 * догадаться ни про `:::infobox`, ни про число двоеточий у вложенных заборов.
 * Заготовка отвечает на оба вопроса сразу — её правят, а не сочиняют.
 *
 * Раньше это была одна строка из тридцати одинаковых кнопок `[ метка ]`,
 * которая переносилась на три ряда как придётся: группы разъезжались по
 * рядам, и найти нужное можно было только прочитав всё. Теперь ряд — это
 * группа, а не остаток места, и у каждого виджета свой значок: набор
 * опознаётся по форме, а не вычитывается.
 *
 * Кнопка палитры сознательно не носит скобки `[ … ]`, которыми в этой системе
 * отмечен всякий приказ. Скобки — форма действия («удалить», «на сайте»), а
 * здесь не действие, а материал: тридцать приказов подряд и были той стеной,
 * из-за которой полосу не читали.
 */

/** Заготовка разметки. */
export interface Snippet {
  label: string;
  title: string;
  text: string;
  /** Строчный виджет ставится в текущую строку, блочный — с новой. */
  inline?: boolean;
  /**
   * Чем обернуть выделение. Выделив слово и нажав «спойлер», хочешь спрятать
   * это слово, а не заменить его образцом — раньше заменяло.
   */
  wrap?: [string, string];
  /** Ключ значка. */
  icon: string;
}

export interface SnippetGroup {
  group: string;
  items: Snippet[];
}

export const SNIPPETS: SnippetGroup[] = [
  {
    group: "в строке",
    items: [
      {
        label: "метка",
        title: "Плашка состояния: :tag[…]{style=warn}",
        text: ":tag[Пропал без вести]{style=warn}",
        wrap: [":tag[", "]{style=warn}"],
        inline: true,
        icon: "tag",
      },
      {
        label: "спойлер",
        title: "Скрыто до щелчка: :spoiler[…]",
        text: ":spoiler[скрытый текст]",
        wrap: [":spoiler[", "]"],
        inline: true,
        icon: "spoiler",
      },
      {
        label: "гриф",
        title: "Вымарано ниже допуска: :classified[…]{level=3}",
        text: ":classified[отчёт 12-Б]{level=3}",
        wrap: [":classified[", "]{level=3}"],
        inline: true,
        icon: "classified",
      },
      {
        label: "дата",
        title: "Метка времени в поясе читателя",
        text: ":timestamp[12.04.2031]{at=2031-04-12T09:00:00Z}",
        inline: true,
        icon: "date",
      },
      {
        label: "отсчёт",
        title: "Обратный отсчёт до срока",
        text: ":countdown[до срока]{until=2033-01-01T00:00:00Z}",
        inline: true,
        icon: "countdown",
      },
      {
        label: "ссылка",
        title: "Ссылка на другую запись: [[Название|слаг]]",
        text: "[[Название|slug]]",
        wrap: ["[[", "]]"],
        inline: true,
        icon: "link",
      },
      {
        label: "подчёрк",
        title: "Подчёркивание: __текст__",
        text: "__подчёркнуто__",
        wrap: ["__", "__"],
        inline: true,
        icon: "underline",
      },
    ],
  },
  {
    group: "блоки",
    items: [
      {
        label: "инфобокс",
        title: "Карточка в колонке справа от документа",
        icon: "infobox",
        text: [
          "::::infobox{title=Досье}",
          ":::fields",
          "ключ :: значение",
          ":::",
          "",
          "::dotbar{name=Допуск max=5 current=3}",
          "",
          ":tag[Метка]{style=warn}",
          "::::",
        ].join("\n"),
      },
      {
        label: "поля",
        title: "Таблица «ключ — значение»",
        text: ":::fields\nключ :: значение\n:::",
        icon: "fields",
      },
      {
        label: "заметка",
        title: "Выноска: справка, внимание, оспорено",
        text: ":::note{style=info}\nТекст заметки.\n:::",
        wrap: [":::note{style=info}\n", "\n:::"],
        icon: "note",
      },
      {
        label: "цитата",
        title: "Цитата с указанием источника",
        text: ':::quote{by="источник"}\nТекст цитаты.\n:::',
        wrap: [':::quote{by="источник"}\n', "\n:::"],
        icon: "quote",
      },
      {
        label: "таблица",
        title: "Таблица markdown",
        text: "| столбец | столбец |\n| --- | --- |\n| значение | значение |",
        icon: "table",
      },
      {
        label: "по центру",
        title: "Блок по центру полосы",
        text: ":::center\nТекст по центру.\n:::",
        wrap: [":::center\n", "\n:::"],
        icon: "center",
      },
      { label: "шкала", title: "Полоса с числом", text: "::bar{name=Готовность max=100 current=60}", icon: "bar" },
      { label: "точки", title: "Дискретная шкала", text: "::dotbar{name=Допуск max=5 current=3}", icon: "dotbar" },
    ],
  },
  {
    group: "медиа",
    items: [
      {
        label: "картинка",
        title: "Изображение с подписью",
        text: '::image{src="uploads/файл.png" caption="Подпись"}',
        icon: "image",
      },
      {
        label: "галерея",
        title: "Несколько изображений в ряд",
        text: ':::gallery\n::image{src="uploads/1.png"}\n::image{src="uploads/2.png"}\n:::',
        icon: "gallery",
      },
      {
        label: "видео",
        title: "Проигрыватель с подписью",
        text: '::video{src="uploads/файл.mp4" poster="uploads/кадр.png" caption="Подпись"}',
        icon: "video",
      },
      {
        label: "файл",
        title: "Вложение для скачивания",
        text: '::file{src="uploads/документ.pdf" name="Документ" size="1,2 МБ"}',
        icon: "file",
      },
      { label: "запись", title: "Карточка другой записи", text: "::record{slug=apollo}", icon: "record" },
      {
        label: "карта",
        title: "Врезка карты с точкой",
        text: "::map{lng=37.6 lat=55.7 zoom=6 label=«Мыс Тишина»}",
        icon: "map",
      },
      {
        label: "событие",
        title: "Отметка о времени со ссылкой в летопись",
        text: '::event{at=2031-04-12 epoch="Разлом"}',
        icon: "event",
      },
    ],
  },
  {
    group: "титульный лист",
    items: [
      { label: "обложка", title: "Титульный лист категории целиком", text: "", icon: "cover" },
      {
        label: "эпиграф",
        title: "Эпиграф титульного листа",
        text: ':::::epigraph{cite="источник"}\nСтрока эпиграфа.\n:::::',
        wrap: [':::::epigraph{cite="источник"}\n', "\n:::::"],
        icon: "epigraph",
      },
      {
        label: "колонки",
        title: "Низ титульного листа: текст и выходные сведения",
        text: ":::::columns\nО чём раздел.\n\n::::right\n:::fields\nзаписей :: 0\n:::\n::::\n:::::",
        icon: "columns",
      },
      { label: "штамп", title: "Штамп на титульном листе", text: "::stamp[для служебного пользования]", icon: "stamp" },
    ],
  },
];

/**
 * Значки.
 *
 * Свои, а не из набора: в JetBrains Mono нет ни инфобокса, ни грифа, а любой
 * готовый набор рисует «документ вообще» — здесь же значок должен показывать
 * именно этот виджет, каким он выйдет на бумаге. Сетка 12×12, штрих в 1
 * пиксель, цвет наследуется: значок живёт в той же волосяной графике, что и
 * весь прибор.
 */
const GLYPHS: Record<string, string> = {
  tag: '<path d="M6.4 1.2h4.4v4.4L5.6 10.8 1.2 6.4z"/><circle cx="8.6" cy="3.4" r=".85" fill="currentColor" stroke="none"/>',
  spoiler: '<path d="M1 6s2.1-3.1 5-3.1S11 6 11 6s-2.1 3.1-5 3.1S1 6 1 6z"/><path d="M2.2 9.8 9.8 2.2"/>',
  classified:
    '<path d="M1.4 2.6h9.2"/><rect x="1.4" y="4.7" width="6.6" height="2.4" fill="currentColor" stroke="none"/><path d="M1.4 9.4h9.2"/>',
  date: '<circle cx="6" cy="6" r="4.6"/><path d="M6 3.3V6l2.1 1.4"/>',
  countdown:
    '<path d="M3 1.4h6M3 10.6h6M3.5 1.4c0 2.4 2.5 3.4 2.5 4.6 0-1.2 2.5-2.2 2.5-4.6M3.5 10.6c0-2.4 2.5-3.4 2.5-4.6 0 1.2 2.5 2.2 2.5 4.6"/>',
  link: '<path d="M4.7 2.8H3.4a3.2 3.2 0 0 0 0 6.4h1.3M7.3 2.8h1.3a3.2 3.2 0 0 1 0 6.4H7.3"/><path d="M4.1 6h3.8"/>',
  underline: '<path d="M3.3 1.8v3.6a2.7 2.7 0 0 0 5.4 0V1.8"/><path d="M2.4 10.2h7.2"/>',
  infobox:
    '<rect x="1.4" y="1.4" width="9.2" height="9.2"/><path d="M1.4 4.1h9.2"/><path d="M3.3 6.2h5.4M3.3 8.3h3.2"/>',
  fields: '<path d="M1.4 3h3.4M7 3h3.6M1.4 6h3.4M7 6h3.6M1.4 9h3.4M7 9h3.6"/>',
  note: '<path d="M2.6 1.5H1.3v9h1.3M9.4 1.5h1.3v9H9.4"/><path d="M6 3.5v3.3"/><circle cx="6" cy="8.9" r=".75" fill="currentColor" stroke="none"/>',
  quote: '<path d="M1.6 2.2v7.6"/><path d="M4 4h6.4M4 6.4h4.6M4 8.8h5.4"/>',
  table: '<rect x="1.4" y="2" width="9.2" height="8"/><path d="M1.4 4.5h9.2M4.5 4.5V10M7.5 4.5V10"/>',
  center: '<path d="M1.8 2.6h8.4M3.4 5.2h5.2M1.8 7.8h8.4M4 10.4h4"/>',
  bar: '<rect x="1.4" y="4.4" width="9.2" height="3.2"/><rect x="1.4" y="4.4" width="5.2" height="3.2" fill="currentColor" stroke="none"/>',
  dotbar:
    '<circle cx="1.9" cy="6" r=".95" fill="currentColor" stroke="none"/><circle cx="4.6" cy="6" r=".95" fill="currentColor" stroke="none"/><circle cx="7.3" cy="6" r=".95" fill="currentColor" stroke="none"/><circle cx="10" cy="6" r=".95"/>',
  image:
    '<rect x="1.4" y="2" width="9.2" height="8"/><path d="m1.4 8.1 2.7-2.7 2 2 2-1.8 2.5 2.4"/><circle cx="4.1" cy="4.4" r=".8"/>',
  gallery: '<rect x="3.6" y="1.4" width="7" height="6"/><rect x="1.4" y="4.6" width="7" height="6"/>',
  video:
    '<rect x="1.4" y="2.4" width="9.2" height="7.2"/><path d="m5 4.6 3.3 1.9L5 8.4z" fill="currentColor" stroke="none"/>',
  file: '<path d="M2.4 1.4h4.3L9.6 4.3v6.3h-7.2z"/><path d="M6.7 1.4v2.9h2.9"/>',
  record:
    '<path d="M1.4 2h6.2v8H1.4z"/><path d="M3 4.3h3M3 6.3h3"/><path d="M8.6 6.5h2.2M9.5 5.3l1.3 1.2-1.3 1.2"/>',
  map: '<path d="M6 10.6S2.3 7.3 2.3 4.9a3.7 3.7 0 0 1 7.4 0c0 2.4-3.7 5.7-3.7 5.7z"/><circle cx="6" cy="4.9" r="1.3"/>',
  event: '<path d="M.9 6h2.7M8.4 6h2.7"/><path d="M6 3.4 8.6 6 6 8.6 3.4 6z"/>',
  cover:
    '<rect x="2" y="1.2" width="8.4" height="9.6"/><path d="M3.1 1.2v9.6"/><path d="M4.6 3.6h4.4M4.6 5.4h4.4"/><path d="M5.4 8.6h2.8"/>',
  epigraph: '<path d="M2 2.8h8M3.2 5.2h5.6M4.4 7.6h3.2"/><path d="M4.8 10h2.4"/>',
  columns: '<rect x="1.4" y="2" width="3.7" height="8"/><rect x="6.9" y="2" width="3.7" height="8"/>',
  stamp:
    '<g transform="rotate(-7 6 6)"><rect x="1.6" y="3.6" width="8.8" height="4.8"/><path d="M3.4 6h5.2"/></g>',
};

export function glyph(name: string): string {
  return (
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
    `stroke-width="1" stroke-linejoin="round" aria-hidden="true">${GLYPHS[name] ?? ""}</svg>`
  );
}
