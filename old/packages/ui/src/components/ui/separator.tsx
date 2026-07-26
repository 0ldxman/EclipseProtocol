"use client"

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  variant = "slash",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> & {
  variant?: "slash" | "pipe"
}) {
  // Вертикальный сепаратор рисуется глифом ("/" по умолчанию или "|")
  if (orientation === "vertical") {
    return (
      <SeparatorPrimitive.Root
        data-slot="separator"
        data-variant={variant}
        decorative={decorative}
        orientation={orientation}
        className={cn(
          "flex shrink-0 select-none items-center self-stretch font-mono text-muted-foreground",
          className
        )}
        {...props}
      >
        {variant === "slash" ? "/" : "|"}
      </SeparatorPrimitive.Root>
    )
  }

  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
