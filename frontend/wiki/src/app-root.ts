/**
 * Where the app lives, and why the routes are hash routes.
 *
 * Two constraints pull in opposite directions. Behind code-server's
 * `/proxy/<port>/` path proxy the browser sees a prefix the server never does,
 * so absolute asset URLs (`/assets/x.js`) miss entirely - which is why every
 * app here is built with a relative base. But relative assets break the other
 * way: opening `/wiki/kremen` directly makes the browser resolve them against
 * `/wiki/`, and they are not there.
 *
 * Hash routes settle it. The document is always fetched from the app root, so
 * relative assets always resolve, and the route travels in the fragment where
 * no proxy touches it. Path-form links still work: `boot()` below converts one
 * into its hash equivalent on arrival, so a pasted `/wiki/kremen` lands on the
 * right page.
 */

/** Directory the app's own bundle was served from - the app root. */
function detectRoot(): string {
  const { pathname } = new URL(import.meta.url);
  const parts = pathname.split("/").filter(Boolean);
  // ".../assets/index-abc.js" in a build, ".../src/app-root.ts" in dev.
  const cut = parts.length >= 2 && (parts.at(-2) === "assets" || parts.at(-2) === "src") ? 2 : 1;
  const root = "/" + parts.slice(0, Math.max(0, parts.length - cut)).join("/");
  return root === "/" ? "" : root;
}

export const appRoot = detectRoot();

/** Absolute href for a route, usable in `<a href>`. */
export const href = (route: string): string => `${appRoot}/#${route}`;

/** Current route, always starting with "/". */
export function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

export function navigate(route: string): void {
  window.location.hash = route;
}

/**
 * Turn a path-form deep link into the hash form once, on arrival.
 * Only runs when there is no hash, so it never fights the router.
 */
export function adoptPathRoute(): void {
  if (window.location.hash) return;
  const path = window.location.pathname.slice(appRoot.length);
  const match = /^\/(wiki|folder|search)\/?(.*)$/.exec(path);
  if (!match) return;
  const route = `/${match[1]}${match[2] ? `/${match[2]}` : ""}`;
  window.history.replaceState(null, "", `${appRoot}/#${route}`);
}
