/**
 * The public wiki.
 *
 * A record is rendered on the server and arrives as HTML, so what runs here is
 * only what has to: routing, the search palette, the anchor rail, and turning
 * server-rendered `[[wiki links]]` into client-side navigation.
 */

import "@aether/theme/theme.css";
import "./style.css";

import { adoptPathRoute, appRoot, currentRoute, navigate } from "./app-root.js";
import { el } from "./dom.js";
import { bindSearchShortcut, siteFoot, siteRail } from "./header.js";
import { renderFolder, renderHome, renderRecord } from "./pages.js";

// Рельс сверху и строка статуса снизу стоят всегда; экраны меняются между ними.
const view = el("main", { class: "view", id: "view" });
document.body.append(el("div", { id: "app" }, [siteRail(), view, siteFoot()]));
bindSearchShortcut();

/**
 * Links inside rendered records point at real URLs (`/wiki/kremen`) because the
 * markup is canonical HTML, not something this app invented. Intercepting them
 * here keeps those URLs meaningful while still navigating without a reload.
 */
document.addEventListener("click", (event) => {
  const anchor = (event.target as HTMLElement | null)?.closest?.("a");
  if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  const match = /\/wiki\/([^/#?]+)$/.exec(url.pathname);
  if (!match) return;
  event.preventDefault();
  navigate(`/wiki/${decodeURIComponent(match[1]!)}`);
});

function failure(error: unknown): void {
  view.replaceChildren(
    el("div", { class: "page" }, [
      el("div", { class: "empty" }, [
        el("b", {}, ["сбой связи"]),
        el("span", {}, [
          error instanceof Error ? error.message : String(error),
          el("br"),
          "Сервер вики не ответил. Обновите страницу.",
        ]),
      ]),
    ]),
  );
}

async function route(): Promise<void> {
  const path = currentRoute();
  window.scrollTo({ top: 0 });
  try {
    const record = /^\/wiki\/(.+)$/.exec(path);
    if (record) return await renderRecord(view, decodeURIComponent(record[1]!));
    const folder = /^\/folder\/(.+)$/.exec(path);
    if (folder) return await renderFolder(view, folder[1]!);
    return await renderHome(view);
  } catch (error) {
    failure(error);
  }
}

adoptPathRoute();
window.addEventListener("hashchange", () => void route());
void route();

// Handy when the page is opened behind a path proxy and something looks wrong.
Object.assign(window as unknown as Record<string, unknown>, { __appRoot: appRoot });
