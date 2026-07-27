/**
 * Ширины колонок.
 *
 * Три вертикали админки — дерево, источник, результат — раньше делили экран в
 * пропорции, зашитой в стиль. Работа же перекашивается: у длинных путей в
 * дереве не хватает 296 пикселей, а в правку таблицы хочется отдать всё, что
 * есть, и просмотр на это время сузить.
 *
 * Разделитель — не полоса в раскладке, а зона захвата поверх волосяной
 * границы: колонки должны сходиться в одну линию, а тянуть за линию в один
 * пиксель нельзя. Отсюда семь пикселей ширины при видимой единице.
 *
 * Клавиатура здесь не формальность: `role=separator` без стрелок — это
 * элемент, до которого можно дойти табом и ничего им не сделать.
 */

const STORE_KEY = "aether.admin.panes";

interface Widths {
  tree: number;
  view: number;
}

const DEFAULTS: Widths = { tree: 296, view: 520 };

/** Пределы: колонка уже этого не показывает ничего полезного. */
const MIN = { tree: 190, view: 300, edit: 320 };
const MAX_TREE = 560;

function load(): Widths {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Widths> | null;
    if (!raw) return { ...DEFAULTS };
    return {
      tree: Number(raw.tree) || DEFAULTS.tree,
      view: Number(raw.view) || DEFAULTS.view,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export class Panes {
  private widths = load();

  constructor(private readonly root: HTMLElement) {
    this.apply();
    addEventListener("resize", () => this.apply());
  }

  /**
   * Свести к тому, что помещается.
   *
   * Считается всегда от текущего окна, а не от сохранённого: ширины лежат в
   * localStorage, и открытая на узком экране админка иначе унесла бы редактор
   * за край.
   */
  private clamp(next: Widths): Widths {
    const total = this.root.clientWidth || window.innerWidth;
    const tree = Math.min(MAX_TREE, Math.max(MIN.tree, Math.round(next.tree)));
    const room = total - tree - MIN.edit;
    const view = Math.max(MIN.view, Math.min(Math.round(next.view), Math.max(MIN.view, room)));
    return { tree, view };
  }

  private apply(): void {
    this.widths = this.clamp(this.widths);
    this.root.style.setProperty("--w-tree", `${this.widths.tree}px`);
    this.root.style.setProperty("--w-view", `${this.widths.view}px`);
    for (const handle of this.root.querySelectorAll<HTMLElement>(".gutter")) {
      const which = handle.dataset.pane as keyof Widths;
      handle.setAttribute("aria-valuenow", String(this.widths[which]));
    }
  }

  private set(which: keyof Widths, value: number): void {
    this.widths = { ...this.widths, [which]: value };
    this.apply();
    localStorage.setItem(STORE_KEY, JSON.stringify(this.widths));
  }

  get(which: keyof Widths): number {
    return this.widths[which];
  }

  /**
   * Повесить разделитель.
   *
   * `sign` учитывает, с какой стороны колонка: дерево растёт вместе с
   * указателем, а просмотр — навстречу ему.
   */
  attach(handle: HTMLElement, which: keyof Widths, sign: 1 | -1): void {
    handle.dataset.pane = which;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-label", which === "tree" ? "Ширина дерева" : "Ширина просмотра");

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-live");
      document.body.classList.add("is-resizing");
      const startX = event.clientX;
      const startWidth = this.widths[which];

      const move = (moveEvent: PointerEvent) => {
        this.set(which, startWidth + (moveEvent.clientX - startX) * sign);
      };
      const stop = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.classList.remove("is-live");
        document.body.classList.remove("is-resizing");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });

    // Двойной щелчок — возврат к исходному: промахнувшись мышью, не нужно
    // потом попадать обратно в те же 296 пикселей.
    handle.addEventListener("dblclick", () => this.set(which, DEFAULTS[which]));

    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 12;
      const current = this.widths[which];
      if (event.key === "ArrowLeft") this.set(which, current - step * sign);
      else if (event.key === "ArrowRight") this.set(which, current + step * sign);
      else if (event.key === "Home") this.set(which, MIN[which]);
      else if (event.key === "End") this.set(which, which === "tree" ? MAX_TREE : 10_000);
      else if (event.key === "Enter" || event.key === " ") this.set(which, DEFAULTS[which]);
      else return;
      event.preventDefault();
    });
  }
}
