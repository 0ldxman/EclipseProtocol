"use client"

import { useParams } from "next/navigation"
import { ArrowLeft, Plus, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@aether/ui/badge"
import { Button } from "@aether/ui/button"
import { Input } from "@aether/ui/input"

import { AdminShell, PageHeader } from "@/components/admin-shell"
import { Empty, Field, Loading } from "@/components/form-bits"
import * as api from "@/lib/api"
import { publicPath } from "@/lib/config"

export default function OrgDetailPage() {
  return (
    <AdminShell>
      <OrgDetail />
    </AdminShell>
  )
}

function OrgDetail() {
  const params = useParams<{ tag: string }>()
  const tag = decodeURIComponent(params.tag)

  const [tiers, setTiers] = useState<api.OrgAccessTier[] | null>(null)
  const [label, setLabel] = useState("")
  const [lvl, setLvl] = useState("0")
  const [perms, setPerms] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTiers(await api.accessTiers.list(tag))
    } catch (e) {
      toast.error(`Не удалось загрузить уровни: ${(e as Error).message}`)
      setTiers([])
    }
  }, [tag])

  useEffect(() => {
    void load()
  }, [load])

  async function createTier(e: React.FormEvent) {
    e.preventDefault()
    if (!label) return
    setBusy(true)
    try {
      await api.accessTiers.create(tag, {
        label,
        lvl: Number(lvl) || 0,
        permissions: splitPerms(perms),
      })
      toast.success(`Уровень «${label}» создан`)
      setLabel("")
      setLvl("0")
      setPerms("")
      await load()
    } catch (e) {
      toast.error(`Ошибка создания: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeTier(t: api.OrgAccessTier) {
    if (!confirm(`Удалить уровень «${t.label}»?`)) return
    try {
      await api.accessTiers.remove(t.id)
      toast.success(`Уровень «${t.label}» удалён`)
      await load()
    } catch (e) {
      toast.error(`Ошибка удаления: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <a
        href={publicPath("/orgs")}
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Все организации
      </a>
      <PageHeader title={tag} />

      <form
        onSubmit={createTier}
        className="mb-6 flex flex-wrap items-end gap-2 border border-border bg-card p-4"
      >
        <Field label="Метка" value={label} onChange={setLabel} placeholder="officer" className="w-40" />
        <Field label="Уровень (lvl)" value={lvl} onChange={setLvl} placeholder="0" className="w-28" />
        <Field
          label="Права (через запятую)"
          value={perms}
          onChange={setPerms}
          placeholder="wiki.edit, map.view"
          className="flex-1 min-w-48"
        />
        <Button type="submit" disabled={busy}>
          <Plus className="size-4" /> Уровень
        </Button>
      </form>

      {tiers === null ? (
        <Loading />
      ) : tiers.length === 0 ? (
        <Empty>У этой организации пока нет уровней доступа.</Empty>
      ) : (
        <div className="space-y-3">
          {tiers.map((t) => (
            <TierCard key={t.id} tier={t} onChanged={load} onRemove={() => removeTier(t)} />
          ))}
        </div>
      )}
    </>
  )
}

function TierCard({
  tier,
  onChanged,
  onRemove,
}: {
  tier: api.OrgAccessTier
  onChanged: () => Promise<void>
  onRemove: () => void
}) {
  const [roles, setRoles] = useState<string[] | null>(null)
  const [roleId, setRoleId] = useState("")

  const loadRoles = useCallback(async () => {
    try {
      setRoles(await api.accessRoles.list(tier.id))
    } catch {
      setRoles([])
    }
  }, [tier.id])

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  async function addRole(e: React.FormEvent) {
    e.preventDefault()
    if (!roleId) return
    try {
      setRoles(await api.accessRoles.add(tier.id, roleId))
      setRoleId("")
    } catch (e) {
      toast.error(`Ошибка: ${(e as Error).message}`)
    }
  }

  async function removeRole(id: string) {
    try {
      await api.accessRoles.remove(tier.id, id)
      await loadRoles()
    } catch (e) {
      toast.error(`Ошибка: ${(e as Error).message}`)
    }
  }

  return (
    <div className="border border-foreground/10 bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="accent">lvl {tier.lvl}</Badge>
          <span className="font-mono text-sm font-medium">{tier.label}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Удалить уровень" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="mt-3">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Права</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {tier.permissions.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            tier.permissions.map((p) => (
              <Badge key={p} variant="outline" className="font-mono">
                {p}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="mt-3">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Discord-роли
        </span>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {roles === null ? (
            <span className="text-xs text-muted-foreground">…</span>
          ) : roles.length === 0 ? (
            <span className="text-xs text-muted-foreground">нет</span>
          ) : (
            roles.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]"
              >
                {r}
                <button
                  type="button"
                  aria-label="Убрать роль"
                  onClick={() => void removeRole(r)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
          <form onSubmit={addRole} className="flex items-center gap-1">
            <Input
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              placeholder="role ID"
              className="h-7 w-32 font-mono text-[11px]"
            />
            <Button type="submit" variant="outline" size="sm">
              <Plus className="size-3" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}

function splitPerms(s: string): string[] {
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
}
