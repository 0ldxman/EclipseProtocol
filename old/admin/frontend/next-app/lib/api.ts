// Типизированный клиент к aether-auth (/auth + /admin).
//
// Доступ-токен (RS256 JWT) живёт только в памяти вкладки. Долгоживущая сессия —
// в httpOnly refresh-куке сервиса (path=/auth), поэтому при старте приложения мы
// делаем POST /auth/refresh, чтобы восстановить сессию, и тем же эндпоинтом
// автоматически обновляем токен при 401.

import { apiBase } from "./config"

// --- типы ответов сервиса ----------------------------------------------------

export type OrgClaim = {
  tag: string
  name: string
  level: number
  label: string
  permissions: string[]
}

export type TokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  discord_id: string
  username: string
  is_admin: boolean
  organizations: OrgClaim[]
}

export type Me = {
  discord_id: string
  username: string
  is_admin: boolean
  organizations: OrgClaim[]
}

export type Org = {
  tag: string
  name: string
  role_id: string
}

export type OrgAccessTier = {
  id: number
  org_tag: string
  label: string
  lvl: number
  permissions: string[]
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// --- хранилище токена в памяти ------------------------------------------------

let accessToken: string | null = null
export function setAccessToken(token: string | null) {
  accessToken = token
}
export function getAccessToken() {
  return accessToken
}

// --- низкоуровневый запрос ----------------------------------------------------

async function parseError(res: Response): Promise<never> {
  let detail = res.statusText
  try {
    const body = await res.json()
    if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)
  } catch {
    /* тело не JSON — оставляем statusText */
  }
  throw new ApiError(res.status, detail)
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  return fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include", // отправляем refresh-куку на /auth/*
  })
}

// Запрос с авто-обновлением токена на 401 (одна попытка).
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, init)
  if (res.status === 401 && path !== "/auth/refresh") {
    const refreshed = await refresh()
    if (refreshed) res = await rawFetch(path, init)
  }
  if (!res.ok) await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// --- auth --------------------------------------------------------------------

// URL для входа через Discord — обычная браузерная навигация (не fetch),
// её делает window.location.href в LoginGate. return_to — собственный
// публичный адрес админки, чтобы /auth/callback на сервисе знал, куда
// вернуть браузер (сервис общий на вики/карту/новости/админку, у каждой
// свой return_to; сверяется там с allowed_return_origin_list).
export function discordLoginUrl(): string {
  const returnTo = typeof window !== "undefined" ? window.location.origin : ""
  const url = new URL(`${apiBase()}/auth/login`, returnTo || undefined)
  if (returnTo) url.searchParams.set("return_to", returnTo)
  return url.toString()
}

// Локальный вход по паролю (ADMIN_PASSWORD на сервисе aether-auth).
export async function passwordLogin(password: string): Promise<TokenResponse> {
  const res = await rawFetch("/auth/login-password", {
    method: "POST",
    body: JSON.stringify({ password }),
  })
  if (!res.ok) await parseError(res)
  const data = (await res.json()) as TokenResponse
  setAccessToken(data.access_token)
  return data
}

export async function refresh(): Promise<TokenResponse | null> {
  let res: Response
  try {
    res = await rawFetch("/auth/refresh", { method: "POST" })
  } catch {
    // сервис недоступен / сеть — трактуем как «нет сессии»
    setAccessToken(null)
    return null
  }
  if (!res.ok) {
    setAccessToken(null)
    return null
  }
  const data = (await res.json()) as TokenResponse
  setAccessToken(data.access_token)
  return data
}

export async function me(): Promise<Me> {
  return request<Me>("/auth/me")
}

export async function logout(): Promise<void> {
  await rawFetch("/auth/logout", { method: "POST" })
  setAccessToken(null)
}

// --- admin: организации ------------------------------------------------------

export const orgs = {
  list: () => request<Org[]>("/admin/orgs"),
  create: (body: Org) =>
    request<Org>("/admin/orgs", { method: "POST", body: JSON.stringify(body) }),
  update: (tag: string, body: Partial<Pick<Org, "name" | "role_id">>) =>
    request<Org>(`/admin/orgs/${encodeURIComponent(tag)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (tag: string) =>
    request<void>(`/admin/orgs/${encodeURIComponent(tag)}`, { method: "DELETE" }),
}

// --- admin: уровни доступа организации ---------------------------------------

export const accessTiers = {
  list: (orgTag: string) =>
    request<OrgAccessTier[]>(`/admin/orgs/${encodeURIComponent(orgTag)}/access`),
  create: (orgTag: string, body: { label: string; lvl: number; permissions: string[] }) =>
    request<OrgAccessTier>(`/admin/orgs/${encodeURIComponent(orgTag)}/access`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (
    accessId: number,
    body: Partial<{ label: string; lvl: number; permissions: string[] }>,
  ) =>
    request<OrgAccessTier>(`/admin/access/${accessId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (accessId: number) =>
    request<void>(`/admin/access/${accessId}`, { method: "DELETE" }),
}

// --- admin: discord-роли уровня доступа --------------------------------------

export const accessRoles = {
  list: (accessId: number) => request<string[]>(`/admin/access/${accessId}/roles`),
  add: (accessId: number, discordRoleId: string) =>
    request<string[]>(`/admin/access/${accessId}/roles`, {
      method: "POST",
      body: JSON.stringify({ discord_role_id: discordRoleId }),
    }),
  remove: (accessId: number, discordRoleId: string) =>
    request<void>(
      `/admin/access/${accessId}/roles/${encodeURIComponent(discordRoleId)}`,
      { method: "DELETE" },
    ),
}

// --- admin: глобальные admin-роли --------------------------------------------

export const adminRoles = {
  list: () => request<string[]>("/admin/admin-roles"),
  add: (discordRoleId: string) =>
    request<string[]>("/admin/admin-roles", {
      method: "POST",
      body: JSON.stringify({ discord_role_id: discordRoleId }),
    }),
  remove: (discordRoleId: string) =>
    request<void>(`/admin/admin-roles/${encodeURIComponent(discordRoleId)}`, {
      method: "DELETE",
    }),
}
