"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

import * as api from "./api"

type AuthState = {
  user: api.Me | null
  loading: boolean
  isAdmin: boolean
  login: (password: string) => Promise<void>
  loginWithDiscord: () => void
  logout: () => Promise<void>
  reload: () => Promise<void>
}

function userFromToken(token: api.TokenResponse): api.Me {
  return {
    discord_id: token.discord_id,
    username: token.username,
    is_admin: token.is_admin,
    organizations: token.organizations,
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.Me | null>(null)
  const [loading, setLoading] = useState(true)

  // Бутстрап сессии: refresh-кука -> свежий access-токен -> данные пользователя.
  async function bootstrap() {
    setLoading(true)
    try {
      const token = await api.refresh()
      setUser(token ? userFromToken(token) : null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void bootstrap()
  }, [])

  const value: AuthState = {
    user,
    loading,
    isAdmin: !!user?.is_admin,
    login: async (password: string) => {
      const token = await api.passwordLogin(password)
      setUser(userFromToken(token))
    },
    // Полная браузерная навигация на /auth/login -> Discord -> /auth/callback,
    // который (если задан ADMIN_URL на сервисе) редиректит обратно сюда же.
    loginWithDiscord: () => {
      window.location.href = api.discordLoginUrl()
    },
    logout: async () => {
      await api.logout()
      setUser(null)
    },
    reload: bootstrap,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}
