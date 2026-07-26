/**
 * The reader's three screens: a record, a folder, and the front page.
 *
 * The record screen is the one the design specifies exactly - anchor rail on
 * the left, article in the middle, infobox in its own column on the right - so
 * it is built that way rather than as a float inside the text. The infobox
 * arrives already separated from the body (the server lifts it out at render
 * time), which is what makes a real column possible without the author having
 * to write the record in two pieces.
 */

import { href, navigate } from "./app-root.js";
import { nav, overview, record, type NavNode, type RecordPage } from "./api.js";
import { classifiedBlock } from "./classified.js";
import { el } from "./dom.js";
import { hydrateWidgets } from "./hydrate.js";
import { articleToc } from "./toc.js";

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" });

const when = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : DATE.format(at);
};

function accessBadge(level: number): HTMLElement | null {
  if (level <= 0) return null;
  return el("span", { class: "badge badge--destructive" }, [`допуск · уровень ${level}`]);
}

function link(route: string, text: string, className = "nav-link"): HTMLElement {
  const anchor = el("a", { class: className, href: href(route) }, [text]);
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(route);
  });
  return anchor;
}

function breadcrumbOf(parts: { id: string; name: string }[]): HTMLElement {
  const trail: (HTMLElement | string)[] = [link("/", "wiki", "crumb")];
  for (const part of parts) {
    trail.push(el("span", { class: "crumb-sep" }, ["/"]), link(`/folder/${part.id}`, part.name, "crumb"));
  }
  return el("nav", { class: "breadcrumb" }, trail);
}

/* ---- record ----------------------------------------------------------- */

function recordArticle(page: RecordPage): HTMLElement {
  const head = el("header", { class: "record-head" }, [
    breadcrumbOf(page.breadcrumb),
    el("h1", { class: "record-title" }, [page.node.name]),
    el("div", { class: "record-meta" }, [
      el("span", { class: "badge badge--secondary" }, [page.node.slug ?? ""]),
      ...page.node.tags.map((tag) => el("span", { class: "badge badge--dot" }, [tag])),
      accessBadge(page.access),
      el("span", { class: "record-when muted" }, [`изменено ${when(page.node.updatedAt)}`]),
    ]),
  ]);

  const body = page.restricted
    ? classifiedBlock(page.access, 18)
    : el("div", { class: "prose record-body", html: page.html });

  // Records conventionally open with `# Title`, and the page already shows the
  // title above the text. Dropping that one heading - only when it is first and
  // only when it repeats the record's name - avoids printing it twice without
  // touching a document that genuinely starts with a different heading.
  const first = body.firstElementChild;
  if (!page.restricted && first?.tagName === "H1" && first.textContent?.trim() === page.node.name) {
    first.remove();
  }

  const article = el("article", { class: "record" }, [head, body]);

  if (page.backlinks.length > 0) {
    article.append(
      el("footer", { class: "backlinks" }, [
        el("h2", { class: "eyebrow" }, ["Ссылаются сюда"]),
        el(
          "ul",
          { class: "backlink-list" },
          page.backlinks.map((back) => el("li", {}, [link(`/wiki/${back.slug}`, back.title)])),
        ),
      ]),
    );
  }
  return article;
}

export async function renderRecord(view: HTMLElement, slug: string): Promise<void> {
  let page: RecordPage;
  try {
    page = await record(slug);
  } catch {
    renderMissing(view, slug);
    return;
  }

  const article = recordArticle(page);

  // The rail is built after the article is in the document: scroll-spy needs
  // real headings with real positions, not a detached fragment.
  const layout = el("div", { class: "record-layout" }, [
    el("div", { class: "toc-slot" }),
    article,
    el("aside", { class: "record-aside" }),
  ]);
  view.replaceChildren(layout);

  const aside = layout.querySelector<HTMLElement>(".record-aside")!;
  if (!page.restricted && page.infoboxes.length > 0) {
    for (const html of page.infoboxes) aside.insertAdjacentHTML("beforeend", html);
  } else {
    aside.remove();
  }

  if (!page.restricted) {
    hydrateWidgets(article);
    // Only headings still in the document get an anchor - the record's own
    // title heading was removed just above.
    const present = page.headings.filter((heading) => document.getElementById(heading.id) !== null);
    const rail = articleToc(present, document.documentElement);
    const slot = layout.querySelector<HTMLElement>(".toc-slot")!;
    if (rail) slot.append(rail);
    else slot.remove();
  } else {
    layout.querySelector(".toc-slot")?.remove();
  }

  document.title = `${page.node.name} — AETHER.WIKI`;
}

function renderMissing(view: HTMLElement, slug: string): void {
  view.replaceChildren(
    el("div", { class: "page" }, [
      el("div", { class: "card card--accent" }, [
        el("div", { class: "eyebrow" }, ["404"]),
        el("p", {}, [`Записи «${slug}» не существует.`]),
        el("p", { class: "muted" }, [
          "Ссылка ведёт на слаг, которого нет в дереве — либо запись ещё не создана, либо слаг изменили.",
        ]),
      ]),
    ]),
  );
  document.title = "Не найдено — AETHER.WIKI";
}

/* ---- folder ----------------------------------------------------------- */

function childList(nodes: NavNode[], parentId: string | null): HTMLElement {
  const children = nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));

  if (children.length === 0) {
    return el("p", { class: "muted" }, ["Пусто."]);
  }

  return el(
    "ul",
    { class: "entry-list" },
    children.map((node) => {
      const count =
        node.kind === "folder" ? nodes.filter((n) => n.parentId === node.id).length : 0;
      const route = node.kind === "folder" ? `/folder/${node.id}` : `/wiki/${node.slug}`;
      return el("li", { class: `entry is-${node.kind}` }, [
        el("span", { class: "entry-mark" }, [node.kind === "folder" ? "▸" : "·"]),
        link(route, node.name, "entry-name"),
        node.kind === "folder" ? el("span", { class: "muted entry-count" }, [`${count}`]) : null,
        accessBadge(node.access),
      ]);
    }),
  );
}

export async function renderFolder(view: HTMLElement, id: string): Promise<void> {
  const { nodes } = await nav();
  const folder = nodes.find((node) => node.id === id);
  if (!folder) {
    renderMissing(view, id);
    return;
  }

  const trail: { id: string; name: string }[] = [];
  let cursor: NavNode | undefined = folder;
  while (cursor?.parentId) {
    const parent: NavNode | undefined = nodes.find((node) => node.id === cursor!.parentId);
    if (!parent) break;
    trail.unshift({ id: parent.id, name: parent.name });
    cursor = parent;
  }

  view.replaceChildren(
    el("div", { class: "page" }, [
      breadcrumbOf(trail),
      el("h1", { class: "record-title" }, [folder.name]),
      el("div", { class: "record-meta" }, [accessBadge(folder.access)]),
      childList(nodes, folder.id),
    ]),
  );
  document.title = `${folder.name} — AETHER.WIKI`;
}

/* ---- front page ------------------------------------------------------- */

export async function renderHome(view: HTMLElement): Promise<void> {
  const [{ nodes }, stats] = await Promise.all([nav(true), overview()]);

  const summary = el("div", { class: "card card--secondary home-stats" }, [
    el("div", { class: "eyebrow" }, ["Состояние архива"]),
    el("div", { class: "rows" }, [
      el("div", { class: "row" }, [
        el("span", { class: "k" }, ["записей"]),
        el("span", { class: "v" }, [String(stats.records)]),
      ]),
      el("div", { class: "row" }, [
        el("span", { class: "k" }, ["категорий"]),
        el("span", { class: "v" }, [String(stats.folders)]),
      ]),
      el("div", { class: "row" }, [
        el("span", { class: "k" }, ["под допуском"]),
        el("span", { class: "v" }, [String(stats.restricted)]),
      ]),
      el("div", { class: "row" }, [
        el("span", { class: "k" }, ["объём"]),
        el("span", { class: "v" }, [`${(stats.bytes / 1024).toFixed(1)} КБ`]),
      ]),
    ]),
  ]);

  const recent = el("div", { class: "card" }, [
    el("div", { class: "eyebrow" }, ["Последние изменения"]),
    stats.recent.length === 0
      ? el("p", { class: "muted" }, ["Пока ничего не записано."])
      : el(
          "ul",
          { class: "entry-list" },
          stats.recent.map((entry) =>
            el("li", { class: "entry is-record" }, [
              el("span", { class: "entry-mark" }, ["·"]),
              link(`/wiki/${entry.slug}`, entry.title, "entry-name"),
              entry.restricted ? el("span", { class: "badge badge--destructive" }, ["допуск"]) : null,
              el("span", { class: "muted entry-count" }, [when(entry.updatedAt)]),
            ]),
          ),
        ),
  ]);

  view.replaceChildren(
    el("div", { class: "page home" }, [
      el("div", { class: "home-hero" }, [
        el("h1", { class: "record-title" }, ["Архив «Eclipse Protocol»"]),
        el("p", { class: "muted" }, [
          "Записи, категории и допуски. Поиск — Ctrl+K.",
        ]),
      ]),
      el("div", { class: "home-grid" }, [
        el("section", { class: "home-tree" }, [
          el("div", { class: "eyebrow" }, ["Категории"]),
          childList(nodes, null),
        ]),
        el("div", { class: "home-side" }, [summary, recent]),
      ]),
    ]),
  );
  document.title = "AETHER.WIKI";
}
