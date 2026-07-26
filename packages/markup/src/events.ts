/**
 * Событие хронологии, объявленное внутри записи.
 *
 * Лента не хранит события отдельно: запись о событии и есть событие. Иначе
 * пришлось бы следить, чтобы два хранилища не разошлись — а они расходятся
 * всегда, обычно в тот момент, когда запись переименовали.
 *
 * Разбор идёт по сырому markdown, а не по дереву, потому что индекс читает
 * материализованные файлы и не должен ради даты поднимать документ целиком.
 */

const EVENT = /^::event\{([^}]*)\}\s*$/gim;

/** `key=value` и `key="value with spaces"`. */
function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pair = /([a-z-]+)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/gi;
  for (let m = pair.exec(source); m; m = pair.exec(source)) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

export interface RecordEvent {
  /** Дата в летописи, как её написал автор: YYYY-MM-DD. */
  at: string;
  epoch: string;
}

/** Первое объявленное событие записи, если оно есть. */
export function eventOf(source: string): RecordEvent | null {
  EVENT.lastIndex = 0;
  for (let m = EVENT.exec(source); m; m = EVENT.exec(source)) {
    const attrs = attributes(m[1] ?? "");
    const at = (attrs.at ?? "").trim();
    if (at) return { at, epoch: (attrs.epoch ?? "").trim() };
  }
  return null;
}

/**
 * Первая картинка записи — то, чем карточка в летописи себя показывает.
 *
 * Берётся так же по сырому тексту: индексу нужен только адрес, и поднимать
 * ради него весь документ значило бы разбирать каждую запись дважды.
 */
export function firstImageOf(source: string): string | null {
  const found = /^::image\{([^}]*)\}\s*$/im.exec(source);
  if (!found) return null;
  const src = attributes(found[1] ?? "").src?.trim();
  return src ? src : null;
}

/** Атрибуты обёртки `:::cover{…}`, без разбора всего документа. */
export function coverAttributes(source: string): Record<string, string> | null {
  const found = /^:{3}cover\{([^}]*)\}\s*$/im.exec(source);
  if (!found) return /^:{3}cover\s*$/im.test(source) ? {} : null;
  return attributes(found[1] ?? "");
}
