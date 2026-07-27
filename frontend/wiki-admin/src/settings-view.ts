/**
 * Настройки архива.
 *
 * Отдельный раздел, а не строчка в свойствах записи: здесь величины, у
 * которых нет владельца среди записей. Первая — год, в котором стоит мир.
 * Летопись подписывала свой хвост словом «сейчас» и системными часами, то
 * есть календарём читателя: архив событий 2031 года, открытый в 2026-м,
 * заканчивался 2026-м. Год мира — такой же авторский факт, как дата события.
 *
 * Форма показывает результат, а не поле ввода: отметка конца ленты собрана
 * здесь же из тех же частей, что и на сайте, и меняется по мере набора. Год
 * без ленты вокруг — просто число, и ошибиться в нём легко.
 */

import type { Api, Settings } from "./api";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

export class SettingsView {
  private value: Settings = { currentYear: null, nowLabel: "" };
  private loaded = false;

  private readonly year = el("input", { type: "number", min: "1", max: "9999", step: "1" });
  private readonly label = el("input", { type: "text", maxlength: "120" });
  private readonly useClock = el("input", { type: "checkbox" });
  private readonly previewYear = el("b", {});
  private readonly previewLabel = el("span", {});

  constructor(
    private readonly host: HTMLElement,
    private readonly api: Api,
    private readonly note: (message: string, isError?: boolean) => void,
  ) {
    this.build();
  }

  private build(): void {
    const close = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, ["закрыть"]);
    close.onclick = () => this.hide();

    this.useClock.onchange = () => {
      this.year.disabled = this.useClock.checked;
      if (this.useClock.checked) void this.save({ currentYear: null });
      else void this.save({ currentYear: Number(this.year.value) || new Date().getFullYear() });
    };

    // Enter и уход фокуса — один и тот же сигнал «готово», поэтому сохранение
    // сверяется с последним известным состоянием: иначе Enter отправлял
    // значение, а следующий за ним blur отправлял его ещё раз — и затирал
    // правку, которая успела прийти между ними.
    const commit = (input: HTMLInputElement, run: () => void) => {
      input.onkeydown = (event) => {
        if (event.key === "Enter") run();
      };
      input.onblur = run;
      input.oninput = () => this.paintPreview();
    };
    commit(this.year, () => {
      const wanted = this.useClock.checked ? null : Number(this.year.value) || null;
      if (wanted === this.value.currentYear) return;
      void this.save({ currentYear: wanted });
    });
    commit(this.label, () => {
      if (this.label.value.trim() === this.value.nowLabel) return;
      void this.save({ nowLabel: this.label.value });
    });

    const preview = el("div", { class: "set-preview" }, [
      el("span", { class: "chrome" }, ["конец летописи"]),
      el("div", { class: "set-now" }, [this.previewYear, this.previewLabel]),
    ]);

    const body = el("div", { class: "dlg__body" }, [
      el("div", { class: "set-block" }, [
        el("span", { class: "chrome" }, ["Летопись · текущий год"]),
        el("div", { class: "set-row" }, [
          this.year,
          el("label", { class: "check" }, [this.useClock, "по календарю"]),
        ]),
        el("div", { class: "note" }, [
          "Год, которым подписан конец ленты. «По календарю» возвращает часы читателя — " +
            "для архива без своей хронологии.",
        ]),
      ]),
      el("div", { class: "set-block" }, [
        el("span", { class: "chrome" }, ["Подпись под отметкой"]),
        el("div", { class: "set-row" }, [this.label]),
        el("div", { class: "note" }, [
          "Пустая — летопись сама напишет, какая эпоха продолжается.",
        ]),
      ]),
      preview,
    ]);

    const dialog = el("div", { class: "dlg", role: "dialog", "aria-label": "Настройки архива" }, [
      el("div", { class: "dlg__head" }, [
        el("span", { class: "dlg__title" }, ["настройки архива"]),
        close,
      ]),
      body,
    ]);

    this.host.replaceChildren(dialog);
    this.host.hidden = true;
    // Щелчок мимо окна и Esc закрывают: раздел открывают, чтобы поправить одно
    // число, и выход из него не должен быть отдельной задачей.
    this.host.onclick = (event) => {
      if (event.target === this.host) this.hide();
    };
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.host.hidden) this.hide();
    });
  }

  async show(): Promise<void> {
    if (!this.loaded) {
      try {
        this.value = await this.api.settings();
        this.loaded = true;
      } catch (error) {
        this.note(`настройки недоступны: ${(error as Error).message}`, true);
        return;
      }
    }
    this.paint();
    this.host.hidden = false;
    this.year.focus();
  }

  hide(): void {
    this.host.hidden = true;
  }

  get isOpen(): boolean {
    return !this.host.hidden;
  }

  private paint(): void {
    this.useClock.checked = this.value.currentYear === null;
    this.year.disabled = this.useClock.checked;
    this.year.value = String(this.value.currentYear ?? new Date().getFullYear());
    this.year.placeholder = String(new Date().getFullYear());
    this.label.value = this.value.nowLabel;
    this.label.placeholder = "эпоха «…» продолжается";
    this.paintPreview();
  }

  private paintPreview(): void {
    const year = this.useClock.checked
      ? new Date().getFullYear()
      : Number(this.year.value) || new Date().getFullYear();
    this.previewYear.textContent = `сейчас · ${year}`;
    this.previewLabel.textContent = this.label.value.trim() || "эпоха «…» продолжается";
  }

  private async save(patch: Partial<Settings>): Promise<void> {
    try {
      this.value = await this.api.saveSettings(patch);
      this.paint();
      this.note("настройки сохранены");
    } catch (error) {
      this.note(`не сохранено: ${(error as Error).message}`, true);
    }
  }
}
