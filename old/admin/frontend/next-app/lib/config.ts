// Запросы к aether-auth идут на тот же origin (/auth, /admin) и проксируются
// Next-ом на реальный сервис (rewrites в next.config.ts).
//
// Под code-server proxy приложение раздаётся из-под префикса (/proxy/3002),
// но сам code-server СРЕЗАЕТ этот префикс перед тем, как переслать запрос
// нашему серверу (см. AGENTS-заметку в next.config.ts) — поэтому Next ничего
// не знает о префиксе (basePath не используем). Префикс нужен ТОЛЬКО для
// значений, которые видит браузер: ссылки навигации и fetch()-урлы.
// Вычисляем его из URL ассета _next в DOM (пусто при прямом доступе).

const explicit = process.env.NEXT_PUBLIC_AUTH_URL ?? ""

function detectPrefix(): string {
  if (typeof document === "undefined") return ""
  const el = document.querySelector('script[src*="/_next/"], link[href*="/_next/"]')
  const url = el?.getAttribute("src") ?? el?.getAttribute("href") ?? ""
  const i = url.indexOf("/_next/")
  return i > 0 ? url.slice(0, i) : ""
}

// База для запросов к auth: явный URL (если задан) либо префикс прокси/origin.
export function apiBase(): string {
  return explicit || detectPrefix()
}

// Префикс прокси для ссылок навигации, которые должны остаться видимыми
// браузеру (next/link тут не годится — Next ничего не знает о префиксе).
export function publicPath(path: string): string {
  return `${detectPrefix()}${path}`
}
