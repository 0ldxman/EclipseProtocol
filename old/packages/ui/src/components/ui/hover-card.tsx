"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"
import { CornerBrackets } from "./card"

const hoverCardVariants = cva(
  "group/hover-card relative z-50 w-64 origin-(--radix-hover-card-content-transform-origin) overflow-hidden rounded-none p-2.5 text-xs/relaxed shadow-md outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  {
    variants: {
      variant: {
        // default и secondary поменяны местами относительно Card
        default:
          "border border-transparent bg-card text-card-foreground ring-1 ring-inset ring-foreground/10 border-t-2 border-t-primary",
        secondary:
          "border border-transparent bg-card text-card-foreground ring-1 ring-inset ring-foreground/10",
        outline:
          "border border-dashed border-muted-foreground/40 bg-card text-card-foreground",
        accent:
          "border border-muted-foreground/30 border-l-2 border-l-primary bg-card text-card-foreground",
        colored: "border border-destructive bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  variant = "default",
  color,
  style,
  children,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> &
  VariantProps<typeof hoverCardVariants> & { color?: string }) {
  const coloredStyle =
    variant === "colored" && color
      ? {
          borderColor: color,
          backgroundColor: `${color}1a`,
          color,
          ...style,
        }
      : style

  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        data-variant={variant}
        align={align}
        sideOffset={sideOffset}
        style={coloredStyle}
        className={cn(hoverCardVariants({ variant }), className)}
        {...props}
      >
        {variant === "secondary" && <CornerBrackets />}
        {children}
      </HoverCardPrimitive.Content>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
