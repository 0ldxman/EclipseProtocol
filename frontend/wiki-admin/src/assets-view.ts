/**
 * Каталог вложений.
 *
 * Отвечает на вопрос, которого в админке не было: куда класть файлы. Загрузка
 * существовала и раньше — но только внутри свойства «снимок события», адрес
 * возвращался один раз, и второй раз найти загруженное было негде. Картинку в
 * запись приходилось вписывать наугад: `::image{src="uploads/файл.png"}` — с
 * именем, которого никто не видел.
 *
 * Поэтому каталог — не галерея, а рабочее место: у каждого файла есть его
 * адрес, готовая строка разметки и кнопка, которая ставит эту строку в
 * открытую запись. Вложение не принадлежит записи (на одну картинку могут
 * ссылаться пять), поэтому в дереве это отдельная полка, а не папка.
 */

import type { Api, Asset, AssetKind } from "./api";

export interface AssetsHooks {
  /** Вставить готовую разметку в открытую запись. */
  insert: (markup: string) => void;
  /** Открыта ли запись — от этого зависит, есть ли куда вставлять. */
  canInsert: () => boolean;
  note: (message: string, isError?: boolean) => void;
}

const KIND_LABEL: Record<AssetKind, string> = {
  image: "изображение",
  video: "видео",
  audio: "звук",
  file: "файл",
};

/** Значок для того, что не показать картинкой. */
const KIND_GLYPH: Record<AssetKind, string> = {
  image: '<path d="M2 4h20v16H2z"/><path d="m2 16 5-5 4 4 4-3.5 7 6.5"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  video: '<path d="M2 5h20v14H2z"/><path d="m10 9 6 3-6 3z" fill="currentColor" stroke="none"/>',
  audio: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9.5a4 4 0 0 1 0 5"/>',
  file: '<path d="M5 2h9l5 5v15H5z"/><path d="M14 2v5h5"/>',
};

function bytes(size: number): string {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`.replace(".", ",");
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Заготовка разметки под тип файла: звук вставляется вложением, виджета нет. */
export function markupFor(asset: Asset): string {
  if (asset.kind === "image") return `::image{src="${asset.url}" caption="Подпись"}`;
  if (asset.kind === "video") return `::video{src="${asset.url}" caption="Подпись"}`;
  return `::file{src="${asset.url}" name="${asset.name}" size="${bytes(asset.bytes)}"}`;
}

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

export class AssetsView {
  private assets: Asset[] = [];
  private filter = "";
  private selected: string | null = null;
  private loaded = false;

  private readonly grid = el("div", { class: "as-grid" });
  private readonly countEl = el("span", { class: "chrome" });
  private readonly filterInput = el("input", { type: "search", placeholder: "фильтр по имени" });
  private readonly fileInput = el("input", { type: "file", multiple: "", hidden: "" });

  constructor(
    private readonly host: HTMLElement,
    private readonly api: Api,
    private readonly base: string,
    private readonly hooks: AssetsHooks,
  ) {
    this.build();
  }

  private build(): void {
    const pick = el("button", { class: "btn btn--sm", type: "button" }, ["загрузить"]);
    pick.onclick = () => this.fileInput.click();
    this.fileInput.onchange = () => {
      const chosen = [...(this.fileInput.files ?? [])];
      this.fileInput.value = "";
      void this.upload(chosen);
    };

    const refresh = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, ["обновить"]);
    refresh.onclick = () => void this.reload();

    this.filterInput.oninput = () => {
      this.filter = this.filterInput.value.trim().toLocaleLowerCase("ru");
      this.paint();
    };

    const head = el("div", { class: "as-head" }, [
      el("span", { class: "chrome chrome--on" }, ["вложения"]),
      this.countEl,
      el("label", { class: "field as-filter" }, [this.filterInput]),
      pick,
      refresh,
      this.fileInput,
    ]);

    const drop = el("div", { class: "as-drop" }, [
      el("b", {}, ["Перетащите файлы сюда"]),
      el("span", {}, ["или нажмите «загрузить». Картинки, видео, звук, PDF и архивы."]),
    ]);

    // Приёмная полоса стоит над сеткой, а не под ней: с полусотней файлов низ
    // каталога — это два экрана вниз, и ответ на «куда кидать» оказывался там,
    // куда за ним никто не пойдёт.
    this.host.replaceChildren(head, el("div", { class: "as-body" }, [drop, this.grid]));

    // Бросок принимается всей полосой, а не только пунктирным прямоугольником:
    // целиться в мишень, когда в руке файл, — лишняя работа.
    const stop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    this.host.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      stop(event);
      this.host.classList.add("is-drop");
    });
    this.host.addEventListener("dragleave", (event) => {
      if (event.target === this.host) this.host.classList.remove("is-drop");
    });
    this.host.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.files.length) return;
      stop(event);
      this.host.classList.remove("is-drop");
      void this.upload([...event.dataTransfer.files]);
    });
  }

  /** Открыть полку: список читается один раз, дальше по кнопке «обновить». */
  async show(): Promise<void> {
    if (!this.loaded) await this.reload();
    else this.paint();
  }

  async reload(): Promise<void> {
    try {
      const { assets } = await this.api.assets();
      this.assets = assets;
      this.loaded = true;
      this.paint();
    } catch (error) {
      this.hooks.note(`каталог недоступен: ${(error as Error).message}`, true);
    }
  }

  async upload(files: File[]): Promise<void> {
    if (files.length === 0) return;
    let stored = 0;
    for (const file of files) {
      this.hooks.note(`загрузка: ${file.name}`);
      try {
        const asset = await this.api.upload(file);
        this.assets.unshift(asset);
        this.selected = asset.name;
        stored += 1;
      } catch (error) {
        this.hooks.note(`не принято: ${file.name} — ${(error as Error).message}`, true);
      }
    }
    this.loaded = true;
    this.paint();
    if (stored > 0) this.hooks.note(stored === 1 ? "файл загружен" : `загружено файлов: ${stored}`);
  }

  private visible(): Asset[] {
    if (!this.filter) return this.assets;
    return this.assets.filter((asset) => asset.name.toLocaleLowerCase("ru").includes(this.filter));
  }

  private paint(): void {
    const list = this.visible();
    const total = this.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    this.countEl.textContent = this.assets.length
      ? `${this.assets.length} · ${bytes(total)}`
      : "пусто";
    this.grid.replaceChildren(...list.map((asset) => this.tile(asset)));
    this.host.classList.toggle("is-empty", this.assets.length === 0);
    if (this.assets.length > 0 && list.length === 0) {
      this.grid.append(
        el("div", { class: "as-none" }, [`Ничего не найдено по «${this.filter}».`]),
      );
    }
  }

  private tile(asset: Asset): HTMLElement {
    const src = `${this.base || ""}/${asset.url}`;
    const preview =
      asset.kind === "image"
        ? el("span", { class: "as-shot" }, [el("img", { src, alt: "", loading: "lazy" })])
        : el("span", { class: "as-shot as-shot--kind" }, [
            svg(KIND_GLYPH[asset.kind]),
            el("span", {}, [KIND_LABEL[asset.kind]]),
          ]);

    const tile = el("div", { class: `as-tile${asset.name === this.selected ? " is-on" : ""}` }, [
      preview,
      el("span", { class: "as-name", title: asset.name }, [asset.name]),
      el("span", { class: "as-meta" }, [`${bytes(asset.bytes)} · ${when(asset.at)}`]),
    ]);

    const put = el("button", { class: "btn btn--sm", type: "button" }, ["в запись"]);
    put.disabled = !this.hooks.canInsert();
    put.title = put.disabled ? "Сначала откройте запись" : "Поставить разметку на место курсора";
    put.onclick = () => {
      this.hooks.insert(markupFor(asset));
      this.hooks.note(`вставлено: ${asset.name}`);
    };

    const copy = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, ["адрес"]);
    copy.onclick = async () => {
      await navigator.clipboard.writeText(asset.url).catch(() => {});
      this.hooks.note(`адрес скопирован: ${asset.url}`);
    };

    const drop = el("button", { class: "btn btn--sm btn--ghost as-del", type: "button", title: "Удалить файл" }, ["×"]);
    drop.onclick = () => this.confirmDelete(asset, drop);

    tile.append(el("span", { class: "as-acts" }, [put, copy, drop]));
    tile.onclick = () => {
      this.selected = asset.name;
      this.paint();
    };
    return tile;
  }

  /**
   * Спрашиваем на месте кнопки, а не системным окном: файл может быть уже
   * вписан в пять записей, и удаление тихо ломает их разметку.
   */
  private confirmDelete(asset: Asset, anchor: HTMLElement): void {
    const yes = el("button", { class: "btn btn--sm btn--danger", type: "button" }, ["удалить"]);
    const no = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, ["нет"]);
    const box = el("span", { class: "as-confirm" }, [yes, no]);
    anchor.replaceWith(box);
    no.onclick = () => this.paint();
    yes.onclick = async () => {
      try {
        await this.api.removeAsset(asset.name);
        this.assets = this.assets.filter((item) => item.name !== asset.name);
        this.hooks.note(`удалено: ${asset.name}`);
      } catch (error) {
        this.hooks.note(`не удалось удалить: ${(error as Error).message}`, true);
      }
      this.paint();
    };
  }
}

function svg(inner: string): SVGSVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("width", "24");
  node.setAttribute("height", "24");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = inner;
  return node;
}
