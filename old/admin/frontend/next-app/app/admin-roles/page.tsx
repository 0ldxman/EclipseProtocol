"use client"

import { Plus, ShieldCheck, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@aether/ui/button"

import { AdminShell, PageHeader } from "@/components/admin-shell"
import { Empty, Field, Loading } from "@/components/form-bits"
import * as api from "@/lib/api"

export default function AdminRolesPage() {
  return (
    <AdminShell>
      <AdminRoles />
    </AdminShell>
  )
}

function AdminRoles() {
  const [roles, setRoles] = useState<string[] | null>(null)
  const [roleId, setRoleId] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setRoles(await api.adminRoles.list())
    } catch (e) {
      toast.error(`Не удалось загрузить роли: ${(e as Error).message}`)
      setRoles([])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!roleId) return
    setBusy(true)
    try {
      setRoles(await api.adminRoles.add(roleId))
      toast.success("Admin-роль добавлена")
      setRoleId("")
    } catch (e) {
      toast.error(`Ошибка: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(`Убрать admin-роль ${id}?`)) return
    try {
      await api.adminRoles.remove(id)
      toast.success("Admin-роль убрана")
      await load()
    } catch (e) {
      toast.error(`Ошибка: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <PageHeader title="Admin-роли" />

      <form
        onSubmit={add}
        className="mb-6 flex flex-wrap items-end gap-2 border border-border bg-card p-4"
      >
        <Field
          label="Discord role ID"
          value={roleId}
          onChange={setRoleId}
          placeholder="1234567890"
          className="flex-1 min-w-48"
        />
        <Button type="submit" disabled={busy}>
          <Plus className="size-4" /> Добавить
        </Button>
      </form>

      {roles === null ? (
        <Loading />
      ) : roles.length === 0 ? (
        <Empty>Admin-ролей нет. Первую добавляют вручную в БД (см. README сервиса).</Empty>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {roles.map((id) => (
            <li key={id} className="flex items-center justify-between px-4 py-2.5">
              <span className="flex items-center gap-2 font-mono text-xs">
                <ShieldCheck className="size-4 text-primary" />
                {id}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Убрать"
                onClick={() => void remove(id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
