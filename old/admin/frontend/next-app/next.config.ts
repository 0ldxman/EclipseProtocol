import path from "node:path"

import type { NextConfig } from "next"

const devPort = process.env.PORT ?? "3002"

// Сервис aether-auth, доступный СО СТОРОНЫ СЕРВЕРА Next (не из браузера).
const authInternalUrl = process.env.AUTH_INTERNAL_URL ?? "http://localhost:8000"

// Хост code-server proxy (VSCODE_PROXY_URI = https://host/proxy/{{port}}/),
// чтобы Next не блокировал dev-ресурсы при доступе через прокси.
const proxyHost = process.env.VSCODE_PROXY_URI
  ? new URL(process.env.VSCODE_PROXY_URI.replace("{{port}}", devPort)).hostname
  : undefined

const nextConfig: NextConfig = {
  ...(proxyHost && { allowedDevOrigins: [proxyHost] }),
  // Общий пакет дизайн-системы поставляется исходным TSX — Next должен его транспилировать.
  transpilePackages: ["@aether/ui"],
  turbopack: {
    // Корень монорепо, чтобы Turbopack видел workspace-пакеты и единый lockfile.
    root: path.join(__dirname, "..", "..", ".."),
  },
  // Браузер ходит на тот же origin (/auth, /admin), Next проксирует на aether-auth.
  // Так работает и локально, и через code-server proxy, и не нужен CORS.
  async rewrites() {
    return [
      { source: "/auth/:path*", destination: `${authInternalUrl}/auth/:path*` },
      { source: "/admin/:path*", destination: `${authInternalUrl}/admin/:path*` },
    ]
  },
  // ВАЖНО: только assetPrefix, НЕ basePath. code-server's path-proxy СРЕЗАЕТ
  // префикс /proxy/<port> перед тем, как переслать запрос нашему серверу
  // (см. out/node/routes/pathProxy.js: target = ...originalUrl.slice(base.length)).
  // Поэтому Next должен матчить роуты БЕЗ префикса — basePath здесь сломает
  // всё (он требует префикс во входящем запросе, которого там уже нет).
  // Браузерные ссылки на префикс навешиваются вручную через lib/config.ts
  // (publicPath), а не через Next-овый basePath.
  ...(process.env.VSCODE_PROXY_URI && {
    assetPrefix: `/proxy/${devPort}`,
  }),
}

export default nextConfig
