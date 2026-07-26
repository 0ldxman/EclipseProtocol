import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const cardVariants = cva(
  "group/card relative flex flex-col gap-(--card-spacing) overflow-hidden rounded-none py-(--card-spacing) text-xs/relaxed [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-none *:[img:last-child]:rounded-none",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-card text-card-foreground ring-1 ring-inset ring-foreground/10",
        main: "border-x border-b border-foreground/10 bg-card text-card-foreground pt-0",
        secondary:
          "border border-transparent bg-card text-card-foreground ring-1 ring-inset ring-foreground/10 border-t-2 border-t-primary",
        outline: "border border-dashed border-muted-foreground/40 bg-card text-card-foreground",
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

function CornerBrackets() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 size-2.5 border-t-2 border-l-2 border-primary"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 size-2.5 border-t-2 border-r-2 border-primary"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 size-2.5 border-b-2 border-l-2 border-primary"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 size-2.5 border-b-2 border-r-2 border-primary"
      />
    </>
  )
}

function Card({
  className,
  size = "default",
  variant = "default",
  color,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & {
    size?: "default" | "sm"
    color?: string
  }) {
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
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      style={coloredStyle}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    >
      {variant === "default" && <CornerBrackets />}
      {children}
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-none px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        "group-data-[variant=main]/card:bg-primary group-data-[variant=main]/card:py-2.5 group-data-[variant=main]/card:text-background",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-sm font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-none border-t p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CornerBrackets,
}
