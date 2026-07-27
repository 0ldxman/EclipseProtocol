/**
 * Вывод документа: печать и расшифровка.
 *
 * Одно движение, а не два. Лист протягивается сверху вниз (это делает CSS),
 * а на протянутом абзац за абзацем проступает текст: сперва он стоит шумом,
 * потом слева направо, в порядке чтения, знаки становятся собой. Читателю
 * показывают не «появление блока», а работу прибора — он принимает документ и
 * разбирает его на глазах.
 *
 * Почему подстановка знака в знак, а не буквы-спаны с задержкой:
 *
 *   — вёрстка не двигается ни на пиксель. Шумовой знак занимает место
 *     настоящего, переносы строк те же самые с первого кадра, и абзац не
 *     перескакивает под курсором;
 *   — разметка внутри абзаца цела. Ссылки остаются ссылками, спойлер —
 *     спойлером; расшифровка идёт по текстовым узлам и не знает, в какой
 *     элемент они вложены;
 *   — пробелы и знаки препинания не подменяются. Слово сохраняет силуэт,
 *     и строка читается как шифровка, а не как каша.
 *
 * Плашки — спойлер и гриф — выезжают слева направо ровно тогда, когда до них
 * доходит фронт расшифровки: в документе они стоят на месте настоящего
 * текста, и появиться раньше него значило бы закрыть то, чего ещё нет.
 *
 * При выключенной анимации ничего этого не происходит: текст стоит на месте
 * сразу, а виджеты получают своё конечное состояние первым же кадром.
 */

/** Чем подменяется знак: свой набор на каждый вид, иначе слово теряет силуэт. */
const CYRILLIC = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

function noiseFor(char: string): string {
  if (char >= "А" && char <= "я") return CYRILLIC[(Math.random() * CYRILLIC.length) | 0]!;
  if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z")) {
    return LATIN[(Math.random() * LATIN.length) | 0]!;
  }
  if (char >= "0" && char <= "9") return DIGITS[(Math.random() * DIGITS.length) | 0]!;
  return char; // пробел, тире, кавычка — остаются собой
}

/** Виджеты, у которых есть собственный выход. Класс ставится, стиль делает CSS. */
const WIDGETS =
  ".w-bar,.w-dotbar,.w-fields,.w-note,.w-quote,.w-image,.w-gallery,.w-video," +
  ".w-file,.w-record,.w-map,.w-table-wrap,.w-infobox,.w-stamp,.w-event,.w-country-stats," +
  // Обычная таблица markdown выходит так же, как `:::table`: строка за
  // строкой. Без неё в списке её строки оставались бы спрятанными навсегда —
  // прятать умеет CSS, показывать умеет только этот список.
  ".prose table";

/** Что расшифровывается. Ячейки таблиц и подписи — тоже текст документа. */
const BLOCKS = "p,h1,h2,h3,h4,li,blockquote,figcaption,dt,dd,th,td,.w-bar-label,.w-quote-by";

/**
 * Где расшифровывается: только на бумаге и в досье.
 *
 * Приборные панели рядом с документом — обратные ссылки, соседи по категории,
 * метки — не документ, а то, что о нём знает система. Она не расшифровывается,
 * она известна.
 */
const DECODE_IN = ".prose,.w-infobox,.cover";

interface Piece {
  node: Text;
  /** Исходная строка: подменяется каждый кадр, поэтому хранится отдельно. */
  text: string;
  /** Смещение начала узла в плоском тексте блока. */
  at: number;
}

interface Mark {
  el: HTMLElement;
  at: number;
}

interface Job {
  block: HTMLElement;
  pieces: Piece[];
  marks: Mark[];
  total: number;
  duration: number;
  startAt: number;
  done: boolean;
}

/**
 * Ширина шумовой полосы перед фронтом, в знаках.
 *
 * Полоса — это и есть видимая часть работы: за ней текст уже свой, перед ней
 * ещё шум, и разбирает документ именно она. Узкая полоса на быстром ходу
 * читается как мигание, а не как разбор.
 */
const BAND = 24;

/**
 * Сколько времени разбирается блок.
 *
 * Растёт медленнее длины: иначе цитата в три строки успевает мигнуть, а
 * раздел на двадцать стоит шумом полминуты. Числа подобраны на глаз — вывод
 * должен читаться как работа прибора, а не как задержка загрузки.
 */
const pace = (length: number): number => Math.min(2600, 620 + Math.sqrt(length) * 95);

/** Пауза между соседними блоками: страница выводится сверху вниз, а не разом. */
const STAGGER = 150;
const STAGGER_CAP = 10;

const jobs: Job[] = [];
let looping = false;

function collect(block: HTMLElement): { pieces: Piece[]; marks: Mark[]; total: number } {
  const pieces: Piece[] = [];
  const marks: Mark[] = [];
  let at = 0;

  const walk = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        if (text.length > 0) {
          pieces.push({ node: child as Text, text, at });
          at += text.length;
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      // Плашка выезжает в тот момент, когда фронт до неё доходит, поэтому её
      // место в плоском тексте нужно знать заранее.
      if (element.classList.contains("w-spoiler") || element.classList.contains("w-classified")) {
        marks.push({ el: element, at });
      }
      walk(element);
    }
  };
  walk(block);
  return { pieces, marks, total: at };
}

function paint(job: Job, front: number): void {
  for (const piece of job.pieces) {
    const start = piece.at;
    const end = start + piece.text.length;
    // Узел целиком позади фронта — он уже свой, трогать нечего.
    if (end <= front - BAND) continue;
    if (start >= front) {
      // Целиком впереди: шум. Строка той же длины, поэтому перенос тот же.
      let out = "";
      for (const char of piece.text) out += noiseFor(char);
      piece.node.nodeValue = out;
      continue;
    }
    let out = "";
    for (let i = 0; i < piece.text.length; i++) {
      const global = start + i;
      out += global < front - BAND ? piece.text[i]! : noiseFor(piece.text[i]!);
    }
    piece.node.nodeValue = out;
  }

  for (const mark of job.marks) {
    if (!mark.el.classList.contains("is-in") && front >= mark.at) mark.el.classList.add("is-in");
  }
}

function settle(job: Job): void {
  for (const piece of job.pieces) piece.node.nodeValue = piece.text;
  for (const mark of job.marks) mark.el.classList.add("is-in");
  job.block.classList.add("is-read");
  job.done = true;
}

function loop(now: number): void {
  let alive = false;
  for (const job of jobs) {
    if (job.done) continue;
    if (!job.block.isConnected) {
      job.done = true;
      continue;
    }
    alive = true;
    if (now < job.startAt) continue;
    const part = (now - job.startAt) / job.duration;
    if (part >= 1) settle(job);
    // Фронт уходит за конец на ширину полосы, иначе хвост не успевает стать
    // собой и последние знаки «дописываются» уже после остановки.
    else paint(job, part * (job.total + BAND));
  }
  looping = alive;
  if (alive) requestAnimationFrame(loop);
  else jobs.length = 0;
}

/**
 * Разобрать один блок.
 *
 * Открыто наружу, потому что расшифровка нужна не только телу записи: год в
 * конце летописи и счётчики на главной — такие же выводимые прибором числа, и
 * заводить им отдельное движение значило бы говорить о том же двумя языками.
 */
export function decode(block: HTMLElement, delay = 0): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    block.classList.add("is-read");
    return;
  }
  block.classList.add("is-cipher");
  start(block, delay);
}

function start(block: HTMLElement, delay: number): void {
  const { pieces, marks, total } = collect(block);
  if (total === 0) {
    block.classList.add("is-read");
    for (const mark of marks) mark.el.classList.add("is-in");
    return;
  }

  const job: Job = {
    block,
    pieces,
    marks,
    total,
    duration: pace(total),
    startAt: performance.now() + delay,
    done: false,
  };
  jobs.push(job);
  paint(job, 0);
  if (!looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
}

/**
 * Включить вывод документа.
 *
 * Наблюдатель, а не разовый проход: длинную запись читают сверху вниз, и
 * разбирать её целиком в первый кадр значит потратить работу на то, чего никто
 * не увидит, — а заодно расшифровать до срока плашки в самом низу.
 */
export function revealArticle(root: HTMLElement): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const widgets = [...root.querySelectorAll<HTMLElement>(WIDGETS)];
  const blocks = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
    (block) =>
      block.closest(DECODE_IN) !== null &&
      // Вложенный блок разбирал бы свой текст дважды: снаружи — как часть
      // родителя, изнутри — как себя, и знаки дрались бы за один узел.
      !block.parentElement?.closest(BLOCKS),
  );

  if (still) {
    for (const element of [...widgets, ...blocks]) element.classList.add("is-in", "is-read");
    for (const bar of root.querySelectorAll(".w-spoiler,.w-classified")) bar.classList.add("is-in");
    return;
  }

  for (const block of blocks) block.classList.add("is-cipher");

  // Очередь: то, что видно сразу, выводится строка за строкой сверху вниз.
  // Всё, до чего дочитали, выводится по мере появления в кадре.
  let queued = 0;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);
        // `is-in` ставится всегда: блок бывает и виджетом сразу — цитата это
        // и figure, и абзац внутри. Без этого такой элемент разбирался бы, но
        // так и остался бы спрятанным.
        element.classList.add("is-in");
        if (element.matches(BLOCKS)) start(element, Math.min(queued++, STAGGER_CAP) * STAGGER);
      }
      // Задержка копится только внутри одной пачки: следующий экран не должен
      // ждать столько же, сколько ждал последний абзац предыдущего.
      queued = 0;
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
  );

  for (const element of [...blocks, ...widgets]) observer.observe(element);
}

/**
 * Показать по мере появления в кадре.
 *
 * Для всего, что не документ: ярлыков категорий, строк указателя, приборных
 * панелей, событий летописи. Класс один и тот же — `is-in`, — а что именно
 * происходит, решает стиль: у ярлыка вытягивается язычок, у события
 * прочерчивается отвод, у панели проступают строки. Здесь только очередь.
 *
 * Исходное «спрятано» вешается отсюда же, классом `is-staged`, а не лежит в
 * стиле само по себе. Разница принципиальная: спрятать в стиле — значит
 * спрятать НАВСЕГДА всё, до чего наблюдатель почему-либо не дошёл, и такую
 * потерю (строки таблицы, не попавшие в список виджетов) мы уже разбирали.
 * Здесь прячет тот же код, который обязан и показать.
 *
 * Задержка копится внутри одной пачки: то, что видно сразу, выходит по
 * очереди сверху вниз, а следующий экран не ждёт столько же, сколько ждал
 * последний элемент предыдущего.
 */
export function revealOnEnter(
  elements: Iterable<HTMLElement>,
  options: { stagger?: number; cap?: number; margin?: string } = {},
): void {
  const list = [...elements];
  if (list.length === 0) return;

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    for (const element of list) element.classList.add("is-in");
    return;
  }
  for (const element of list) element.classList.add("is-staged");

  const stagger = options.stagger ?? 90;
  const cap = options.cap ?? 8;
  let queued = 0;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);
        element.style.setProperty("--in-delay", `${Math.min(queued++, cap) * stagger}ms`);
        element.classList.add("is-in");
      }
      queued = 0;
    },
    // Кадр считается ниже, чем он есть: то, что стоит сразу под сгибом,
    // выводится заранее. Иначе страница, снятая целиком или пролистанная
    // рывком, показывает наполовину пустую панель — а пустая панель читается
    // как поломка, а не как «ещё не дошло».
    { rootMargin: options.margin ?? "0px 0px 14% 0px", threshold: 0.01 },
  );

  for (const element of list) observer.observe(element);
}
