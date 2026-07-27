/**
 * Настройки архива.
 *
 * Здесь живёт то, что относится ко всей вики сразу и не принадлежит ни одной
 * записи. Пока таких величин немного, но у них общее свойство: их знает
 * редактор мира, а не сервер, и вычислить их неоткуда.
 *
 * Первая из них — текущий год. Летопись рисовала «сейчас» по системным часам,
 * то есть по календарю читателя, и конец ленты сообщал 2026-й посреди событий
 * 2031-го. Год мира — такой же авторский факт, как дата события, и должен
 * задаваться, а не подсматриваться.
 *
 * Хранилище устроено как `TreeStore`: один JSON, запись через временный файл
 * с переименованием. Отдельная база ради шести полей была бы неуместна.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Settings {
  /**
   * Год, в котором сейчас находится мир.
   *
   * `null` значит «идти по настоящим часам» — это состояние по умолчанию, и
   * оно должно оставаться выразимым: архив без выдуманной хронологии не
   * обязан выдумывать себе год.
   */
  currentYear: number | null;
  /** Подпись у отметки конца ленты. Пустая — берётся значение по умолчанию. */
  nowLabel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  currentYear: null,
  nowLabel: "",
};

/** Год мира: настройка, а если её нет — календарь читателя. */
export function resolveYear(settings: Settings): number {
  return settings.currentYear ?? new Date().getFullYear();
}

const MIN_YEAR = 1;
const MAX_YEAR = 9999;

export class SettingsStore {
  private value: Settings = { ...DEFAULT_SETTINGS };
  private loaded = false;

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.file, "utf8");
      this.value = this.sanitise(JSON.parse(raw) as Partial<Settings>);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  get(): Settings {
    return { ...this.value };
  }

  /**
   * Правка по частям: присланные поля заменяются, остальные остаются как были.
   * Так поле формы можно сохранять по одному, не пересылая весь набор.
   */
  async patch(patch: Partial<Settings>): Promise<Settings> {
    this.value = this.sanitise({ ...this.value, ...patch });
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 1), "utf8");
    await rename(temporary, this.file);
    return this.get();
  }

  /** Чужой JSON — не наш тип: проверяется всё, что пришло. */
  private sanitise(input: Partial<Settings>): Settings {
    const year = input.currentYear;
    const clean: Settings = {
      currentYear:
        year === null || year === undefined || !Number.isFinite(Number(year))
          ? null
          : Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.round(Number(year)))),
      nowLabel: String(input.nowLabel ?? "").trim().slice(0, 120),
    };
    return clean;
  }
}
