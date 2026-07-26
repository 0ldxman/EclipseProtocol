"use client"

import { usePathname } from "next/navigation"
import {
  Building2,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

import { Button } from "@aether/ui/button"
import { Input } from "@aether/ui/input"
import { Separator } from "@aether/ui/separator"
import { cn } from "@aether/ui/utils"

import { publicPath } from "@/lib/config"
import { useAuth } from "@/lib/auth-context"

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard },
  { href: "/orgs", label: "Организации", icon: Building2 },
  { href: "/admin-roles", label: "Admin-роли", icon: ShieldCheck },
]

function Diamond() {
  return (
    <svg viewBox="0 0 12 12" className="size-5 shrink-0" aria-hidden>
      <polygon
        points="6,0.75 11.25,6 6,11.25 0.75,6"
        strokeWidth={1}
        className="fill-none stroke-primary"
      />
      <polygon
        points="6,3.75 8.25,6 6,8.25 3.75,6"
        className="cn-live-dot fill-primary"
      />
    </svg>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">{children}</div>
  )
}

function LoginGate({
  login,
  loginWithDiscord,
}: {
  login: (password: string) => Promise<void>
  loginWithDiscord: () => void
}) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    try {
      await login(password)
    } catch (err) {
      toast.error(`Вход не выполнен: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col items-center gap-4 border border-foreground/10 bg-card p-8 text-center"
      >
        <Diamond />
        <div>
          <h1 className="font-mono text-sm font-semibold tracking-[0.2em]">
            AETHER<span className="text-primary">.</span>ADMIN
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Введите пароль администратора.
          </p>
        </div>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="пароль"
          autoFocus
          className="text-center font-mono"
        />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Проверка…" : "Войти"}
        </Button>
        <div className="flex w-full items-center gap-2">
          <Separator className="flex-1" />
          <span className="text-[10px] text-muted-foreground">или</span>
          <Separator className="flex-1" />
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={loginWithDiscord}>
          Войти через Discord
        </Button>
      </form>
    </Centered>
  )
}

/** Каркас админки + guard: пускает только аутентифицированных админов. */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, isAdmin, login, loginWithDiscord, logout } = useAuth()

  if (loading) {
    return (
      <Centered>
        <p className="animate-pulse font-mono text-xs text-muted-foreground">
          АВТОРИЗАЦИЯ…
        </p>
      </Centered>
    )
  }

  if (!user) {
    return <LoginGate login={login} loginWithDiscord={loginWithDiscord} />
  }

  if (!isAdmin) {
    return (
      <Centered>
        <div className="flex w-full max-w-sm flex-col items-center gap-4 border border-destructive/40 bg-destructive/10 p-8 text-center text-destructive">
          <ShieldAlert className="size-6" />
          <div>
            <h1 className="font-mono text-sm font-semibold">ДОСТУП ЗАПРЕЩЁН</h1>
            <p className="mt-2 text-xs">
              У учётной записи <span className="font-medium">@{user.username}</span>{" "}
              нет прав администратора.
            </p>
          </div>
          <Button variant="outline" onClick={() => void logout()}>
            Выйти
          </Button>
        </div>
      </Centered>
    )
  }

  return (
    <div className="flex min-h-svh">
      {/* боковая навигация */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Diamond />
          <span className="font-mono text-sm font-semibold tracking-[0.18em]">
            AETHER<span className="text-primary">.</span>ADMIN
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            return (
              // Обычный <a>, не next/link: под code-server proxy сервер видит
              // путь без префикса /proxy/<port> (прокси сам его срезает), а
              // браузеру префикс нужен в адресной строке — см. lib/config.ts.
              <a
                key={href}
                href={publicPath(href)}
                className={cn(
                  "flex items-center gap-2.5 rounded-none border-l-2 border-transparent px-3 py-2 text-xs transition-colors",
                  active
                    ? "border-l-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </a>
            )
          })}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-col leading-tight">
            <span className="font-mono text-xs font-medium">@{user.username}</span>
            <span className="text-[10px] uppercase tracking-wide text-primary">
              ROOT
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => void logout()}
          >
            Выйти
          </Button>
        </div>
      </aside>

      {/* контент */}
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-4xl px-8 py-8">{children}</div>
      </main>
    </div>
  )
}

/** Заголовок секции. */
export function PageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="mb-6 border-b border-border pb-4">
      <h1 className="font-mono text-lg font-semibold tracking-tight">{title}</h1>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </header>
  )
}
