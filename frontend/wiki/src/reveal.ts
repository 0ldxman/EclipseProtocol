/**
 * Вывод документа: печать и расшифровка.
 *
 * Одно движение, а не два. Лист протягивается сверху вниз (это делает CSS), а
 * на протянутом слева направо, в порядке чтения, идёт фронт печати. Устроен он
 * в три полосы:
 *
 *   — впереди фронта пусто. Знака ещё нет — прибор до него не дошёл;
 *   — под фронтом знак перебирается: он уже напечатан, но ещё не опознан, и
 *     машина крутит его, пока не сойдётся;
 *   — позади фронта знак свой и больше не меняется.
 *
 * Читателю показывают не «появление блока», а работу прибора: он принимает
 * документ знак за знаком и разбирает каждый на глазах.
 *
 * Почему подстановка внутри текстовых узлов, а не буквы-спаны с задержкой:
 *
 *   — вёрстка не двигается ни на пиксель. Ненапечатанный хвост стоит на своих
 *     местах прозрачным (`.ae-rest`), а не вырезается, поэтому переносы строк
 *     те же самые с первого кадра и абзац не перескакивает под курсором;
 *   — разметка внутри абзаца цела. Ссылки остаются ссылками, спойлер —
 *     спойлером; расшифровка идёт по текстовым узлам и не знает, в какой
 *     элемент они вложены;
 *   — пробелы и знаки препинания не подменяются. Слово сохраняет силуэт,
 *     и строка читается как шифровка, а не как каша.
 *
 * Плашки — спойлер и гриф — выезжают слева направо ровно тогда, когда до них
 * доходит фронт: в документе они стоят на месте настоящего текста, и появиться
 * раньше него значило бы закрыть то, чего ещё нет.
 *
 * При выключенной анимации ничего этого не происходит: текст стоит на месте
 * сразу, а виджеты получают своё конечное состояние первым же кадром.
 */

/** Чем подменяется знак: свой набор на каждый вид, иначе слово теряет силуэт. */
const CYRILLIC = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

function setFor(char: string): string | null {
  if ((char >= "А" && char <= "я") || char === "ё" || char === "Ё") return CYRILLIC;
  if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z")) return LATIN;
  if (char >= "0" && char <= "9") return DIGITS;
  return null; // пробел, тире, кавычка — остаются собой
}

/** Разброс из числа: тот же довод даёт тот же знак, разный — разный. */
function hash(seed: number): number {
  let n = seed | 0;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n ^= n >>> 12;
  n = Math.imul(n, 0x297a2d39);
  return (n ^ (n >>> 15)) >>> 0;
}

/**
 * Как долго знак стоит одним и тем же перебором, мс.
 *
 * Раньше знак менялся каждый кадр — шестьдесят раз в секунду. С такой частотой
 * перебора не видно вовсе: полоса просто мутнеет. Знак должен успеть
 * прочитаться неверным, и только тогда смениться.
 */
const TICK = 70;

/**
 * Сколько времени знак проводит под фронтом, мс.
 *
 * Это и есть постоянная всего вывода: столько глаз смотрит на один знак, и
 * ровно от неё считается ширина полосы перебора. Держать постоянной полосу, а
 * не время, значило бы менять скорость разбора знака от длины абзаца.
 */
const DWELL = 260;

/** Границы полосы: у строки в три слова она узкая, у раздела — широкая. */
const BAND_MIN = 3;
const BAND_MAX = 48;

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

/**
 * Один текстовый узел, разложенный на три полосы.
 *
 * Узел остаётся на своём месте и держит разобранное начало; следом за ним
 * стоят два спана — перебор и ненапечатанный хвост. Так знак меняется
 * подстановкой в строку, а видимость трёх состояний остаётся за стилем.
 */
interface Piece {
  /** Исходный узел: в нём копится уже разобранное начало. */
  node: Text;
  /** Знаки под фронтом — те, что сейчас перебираются. */
  band: HTMLElement;
  /** Хвост: настоящий текст, стоящий прозрачным до своей очереди. */
  rest: HTMLElement;
  /** Исходная строка: содержимое узлов меняется каждый кадр, она — нет. */
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
  /** Ширина полосы перебора в знаках — считается из `DWELL` и скорости хода. */
  band: number;
  /**
   * Своя соль на блок.
   *
   * Без неё перебор зависел бы только от места знака в строке, и три абзаца,
   * пошедшие разом, начинались бы одними и теми же буквами — видно сразу и
   * читается как повтор, а не как шифр.
   */
  salt: number;
  duration: number;
  startAt: number;
  started: boolean;
  done: boolean;
}

/**
 * Сколько времени разбирается блок.
 *
 * Растёт медленнее длины: иначе цитата в три строки успевает мигнуть, а
 * раздел на двадцать стоит шумом полминуты. Числа подобраны на глаз — вывод
 * должен читаться как работа прибора, а не как задержка загрузки.
 */
const pace = (length: number): number => Math.min(3400, 700 + Math.sqrt(length) * 110);

/** Пауза между соседними блоками: страница выводится сверху вниз, а не разом. */
const STAGGER = 150;
const STAGGER_CAP = 10;

const jobs: Job[] = [];
/** Разложенные, но ещё не запущенные блоки — чтобы не разбирать один дважды. */
const ready = new WeakMap<HTMLElement, Job>();
let looping = false;

function collect(block: HTMLElement): { pieces: Piece[]; marks: Mark[]; total: number } {
  const found: { node: Text; text: string; at: number }[] = [];
  const marks: Mark[] = [];
  let at = 0;

  const walk = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        if (text.length > 0) {
          found.push({ node: child as Text, text, at });
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

  // Спаны навешиваются вторым проходом: вставлять их во время обхода значило бы
  // считать смещения по дереву, которое сам же и меняешь.
  const pieces = found.map(({ node, text, at: offset }) => {
    const band = document.createElement("span");
    const rest = document.createElement("span");
    band.className = "ae-band";
    rest.className = "ae-rest";
    node.after(band, rest);
    return { node, band, rest, text, at: offset };
  });
  return { pieces, marks, total: at };
}

function paint(job: Job, front: number, now: number): void {
  const band = job.band;
  for (const piece of job.pieces) {
    const from = piece.at;
    const to = from + piece.text.length;

    // Узел целиком позади фронта — он уже свой, трогать нечего.
    if (to <= front - band) {
      if (piece.node.nodeValue !== piece.text) {
        piece.node.nodeValue = piece.text;
        piece.band.textContent = "";
        piece.rest.textContent = "";
      }
      continue;
    }
    // Целиком впереди: знаков ещё нет, но место под них занято.
    if (from >= front) {
      if (piece.node.nodeValue !== "") {
        piece.node.nodeValue = "";
        piece.band.textContent = "";
        piece.rest.textContent = piece.text;
      }
      continue;
    }

    const settled = Math.max(0, Math.floor(front - band) - from);
    const printed = Math.min(piece.text.length, Math.ceil(front) - from);
    let out = "";
    for (let i = settled; i < printed; i++) {
      const char = piece.text[i]!;
      const set = setFor(char);
      if (set === null) {
        out += char;
        continue;
      }
      // Каждый знак крутится со своей фазой: в общий такт полоса мигала бы
      // разом, а прибор перебирает знаки независимо друг от друга.
      const index = Math.imul(from + i + job.salt, 0x9e3779b1);
      const tick = ((now + (hash(index) % TICK)) / TICK) | 0;
      out += set[hash(index ^ Math.imul(tick, 0x85ebca6b)) % set.length]!;
    }
    piece.node.nodeValue = piece.text.slice(0, settled);
    piece.band.textContent = out;
    piece.rest.textContent = piece.text.slice(printed);
  }

  for (const mark of job.marks) {
    if (!mark.el.classList.contains("is-in") && front >= mark.at) mark.el.classList.add("is-in");
  }
}

function settle(job: Job): void {
  // Спаны снимаются: разобранный документ должен остаться обычным текстом —
  // его выделяют, копируют и ищут по нему.
  for (const piece of job.pieces) {
    piece.node.nodeValue = piece.text;
    piece.band.remove();
    piece.rest.remove();
  }
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
    else paint(job, part * (job.total + job.band), now);
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
  prepare(block);
  start(block, delay);
}

/**
 * Погасить блок и разложить его на полосы, не начиная разбора.
 *
 * Делается заранее, в тот же кадр, что и пометка блока к выводу. Иначе между
 * пометкой и очередью — а очередь у нижних абзацев наступает через экран
 * прокрутки — готовый текст успевал бы постоять на виду и погаснуть, и вывод
 * читался бы как сбой, а не как печать.
 */
function prepare(block: HTMLElement): Job | null {
  const known = ready.get(block);
  if (known) return known;

  const { pieces, marks, total } = collect(block);
  if (total === 0) {
    block.classList.add("is-read");
    for (const mark of marks) mark.el.classList.add("is-in");
    return null;
  }

  const duration = pace(total);
  const job: Job = {
    block,
    pieces,
    marks,
    total,
    // Полоса — производная: сколько знаков пройдёт под фронтом за `DWELL`.
    // Короткая строка получает узкую полосу и печатается почти по знаку,
    // длинный абзац — широкую, и по нему идёт волна разбора.
    band: Math.min(BAND_MAX, Math.max(BAND_MIN, Math.round((DWELL * total) / duration))),
    salt: (Math.random() * 0xffff) | 0,
    duration,
    startAt: 0,
    started: false,
    done: false,
  };
  ready.set(block, job);
  paint(job, 0, performance.now());
  return job;
}

function start(block: HTMLElement, delay: number): void {
  const job = prepare(block);
  if (job === null || job.started) return;

  job.started = true;
  job.startAt = performance.now() + delay;
  jobs.push(job);
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

  // Гасится вся запись сразу, разбирается — по мере чтения. Порядок важен:
  // блок, помеченный к выводу, но ещё не разложенный, стоит готовым текстом.
  for (const block of blocks) {
    block.classList.add("is-cipher");
    prepare(block);
  }

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
