"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "../../lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function ProjectionLines({
  contentRef,
}: {
  contentRef: React.RefObject<HTMLElement | null>
}) {
  const [cursor, setCursor] = React.useState<{ x: number; y: number } | null>(
    null
  )
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const frame = React.useRef<number | null>(null)

  React.useEffect(() => {
    function onMove(e: PointerEvent) {
      if (frame.current != null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        setCursor({ x: e.clientX, y: e.clientY })
        if (contentRef.current) {
          setRect(contentRef.current.getBoundingClientRect())
        }
      })
    }
    window.addEventListener("pointermove", onMove)
    return () => {
      window.removeEventListener("pointermove", onMove)
      if (frame.current != null) cancelAnimationFrame(frame.current)
    }
  }, [contentRef])

  if (!cursor || !rect || typeof document === "undefined") return null

  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]

  return createPortal(
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 size-full"
      style={{ width: "100vw", height: "100vh" }}
    >
      {corners.map((c, i) => (
        <line
          key={i}
          x1={c.x}
          y1={c.y}
          x2={cursor.x}
          y2={cursor.y}
          className="stroke-primary"
          strokeWidth={1}
          strokeOpacity={0.6}
        />
      ))}
    </svg>,
    document.body
  )
}

function TooltipContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const contentRef = React.useRef<HTMLDivElement>(null)

  return (
    <>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={contentRef}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-none border-t-2 border-t-primary bg-popover px-3 py-1.5 text-xs text-foreground ring-1 ring-inset ring-foreground/10 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-none data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
    <ProjectionLines contentRef={contentRef} />
    </>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
