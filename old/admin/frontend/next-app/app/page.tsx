"use client"

import { Building2, ShieldCheck } from "lucide-react"

import { Card, CardHeader, CardTitle } from "@aether/ui/card"

import { AdminShell, PageHeader } from "@/components/admin-shell"
import { publicPath } from "@/lib/config"

export default function DashboardPage() {
  return (
    <AdminShell>
      <PageHeader title="Дашборд" />
      <div className="grid gap-4 sm:grid-cols-2">
        <a href={publicPath("/orgs")}>
          <Card variant="secondary" className="h-full transition-colors hover:ring-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-primary" /> Организации
              </CardTitle>
            </CardHeader>
          </Card>
        </a>

        <a href={publicPath("/admin-roles")}>
          <Card variant="secondary" className="h-full transition-colors hover:ring-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Admin-роли
              </CardTitle>
            </CardHeader>
          </Card>
        </a>
      </div>
    </AdminShell>
  )
}
