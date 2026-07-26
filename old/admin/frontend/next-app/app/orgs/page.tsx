"use client"

import { ChevronRight, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@aether/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@aether/ui/table"

import { AdminShell, PageHeader } from "@/components/admin-shell"
import { Empty, Field, Loading } from "@/components/form-bits"
import * as api from "@/lib/api"
import { publicPath } from "@/lib/config"

export default function OrgsPage() {
  return (
    <AdminShell>
      <Orgs />
    </AdminShell>
  )
}

function Orgs() {
  const [orgs, setOrgs] = useState<api.Org[] | null>(null)
  const [tag, setTag] = useState("")
  const [name, setName] = useState("")
  const [roleId, setRoleId] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      setOrgs(await api.orgs.list())
    } catch (e) {
      toast.error(`Не удалось загрузить организации: ${(e as Error).message}`)
      setOrgs([])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!tag || !name || !roleId) return
    setBusy(true)
    try {
      await api.orgs.create({ tag, name, role_id: roleId })
      toast.success(`Организация «${name}» создана`)
      setTag("")
      setName("")
      setRoleId("")
      await load()
    } catch (e) {
      toast.error(`Ошибка создания: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(org: api.Org) {
    if (!confirm(`Удалить организацию «${org.name}»?`)) return
    try {
      await api.orgs.remove(org.tag)
      toast.success(`«${org.name}» удалена`)
      await load()
    } catch (e) {
      toast.error(`Ошибка удаления: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <PageHeader title="Организации" />

      <form
        onSubmit={create}
        className="mb-6 flex flex-wrap items-end gap-2 border border-border bg-card p-4"
      >
        <Field label="Тег" value={tag} onChange={setTag} placeholder="apollo" className="w-28" />
        <Field label="Название" value={name} onChange={setName} placeholder="Протокол Аполлон" className="flex-1 min-w-40" />
        <Field
          label="Discord role ID"
          value={roleId}
          onChange={setRoleId}
          placeholder="1234567890"
          className="w-44"
        />
        <Button type="submit" disabled={busy}>
          <Plus className="size-4" /> Добавить
        </Button>
      </form>

      {orgs === null ? (
        <Loading />
      ) : orgs.length === 0 ? (
        <Empty>Организаций пока нет.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тег</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Discord role ID</TableHead>
              <TableHead className="w-24 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs.map((org) => (
              <TableRow key={org.tag}>
                <TableCell className="font-mono text-primary">{org.tag}</TableCell>
                <TableCell>
                  <a
                    href={publicPath(`/orgs/${encodeURIComponent(org.tag)}`)}
                    className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                  >
                    {org.name}
                    <ChevronRight className="size-3" />
                  </a>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{org.role_id}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Удалить"
                    onClick={() => void remove(org)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
