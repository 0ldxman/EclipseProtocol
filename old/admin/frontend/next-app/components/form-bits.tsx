"use client"

import { type ReactNode } from "react"

import { Input } from "@aether/ui/input"

/** Подписанное текстовое поле формы. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 font-mono text-xs"
      />
    </label>
  )
}

export function Loading() {
  return (
    <p className="animate-pulse py-8 text-center font-mono text-xs text-muted-foreground">
      ЗАГРУЗКА…
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
      {children}
    </p>
  )
}
