/**
 * Directory the page was served from, used to build asset and socket URLs.
 *
 * The app has to work both at the server root and behind code-server's
 * `/proxy/<port>/` path proxy, which strips its prefix before forwarding. The
 * browser therefore sees a prefix the server never does, so every URL the
 * client builds must be relative to wherever the page itself came from.
 *
 * Naively stripping the last path segment breaks on "/proxy/3010" (no trailing
 * slash), which would yield "/proxy". Only strip a final segment when it looks
 * like a file name.
 */
export function baseDir(pathname: string = window.location.pathname): string {
  if (pathname.endsWith("/")) return pathname.slice(0, -1);
  const cut = pathname.lastIndexOf("/");
  const last = pathname.slice(cut + 1);
  return last.includes(".") ? pathname.slice(0, cut) : pathname;
}
