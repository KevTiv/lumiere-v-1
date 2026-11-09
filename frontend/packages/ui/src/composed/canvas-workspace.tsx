"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { SlidersHorizontal, X } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { cn } from "../lib/utils"

interface CanvasWorkspaceProps {
  children: ReactNode
  toolbar: ReactNode
  controls: ReactNode
  controlsLabel: string
  controlsTitle: string
  controlsDescription?: string
  side?: "left" | "right"
  className?: string
}

export function CanvasWorkspace({
  children,
  toolbar,
  controls,
  controlsLabel,
  controlsTitle,
  controlsDescription,
  side = "right",
  className,
}: CanvasWorkspaceProps) {
  const { t } = useTranslation()
  const [controlsOpen, setControlsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const focusTitle = useRef(false)
  const panelId = useId()
  const titleId = useId()

  useEffect(() => {
    if (controlsOpen && focusTitle.current) {
      focusTitle.current = false
      titleRef.current?.focus()
    }
  }, [controlsOpen])

  const closeControls = () => {
    setControlsOpen(false)
    triggerRef.current?.focus()
  }

  // A 16rem rail can dock once the canvas has at least 32rem left. The
  // compact panel covers the canvas without resizing or remounting it.
  const panel = (
    <aside
      id={panelId}
      aria-labelledby={titleId}
      className={cn(
        "absolute inset-0 z-10 min-h-0 min-w-0 flex-col bg-card @min-[48rem]/canvas-workspace:static @min-[48rem]/canvas-workspace:flex @min-[48rem]/canvas-workspace:w-64 @min-[48rem]/canvas-workspace:shrink-0",
        side === "right" ? "@min-[48rem]/canvas-workspace:border-l" : "@min-[48rem]/canvas-workspace:border-r",
        controlsOpen ? "flex" : "hidden",
      )}
      onFocusCapture={() => setControlsOpen(true)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || !triggerRef.current?.getClientRects().length) return
        event.stopPropagation()
        closeControls()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-sm font-semibold [overflow-wrap:anywhere]">
            {controlsTitle}
          </h2>
          {controlsDescription ? <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{controlsDescription}</p> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 @min-[48rem]/canvas-workspace:hidden"
          aria-label={t("common.close")}
          onClick={closeControls}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere]" data-slot="canvas-controls-body">
        {controls}
      </div>
    </aside>
  )

  return (
    <div className={cn("@container/canvas-workspace flex h-full min-h-0 w-full min-w-0 flex-col", className)}>
      <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 max-w-full whitespace-normal @min-[48rem]/canvas-workspace:hidden"
          aria-controls={panelId}
          aria-expanded={controlsOpen}
          onClick={() => {
            if (controlsOpen) closeControls()
            else {
              focusTitle.current = true
              setControlsOpen(true)
            }
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          {controlsLabel}
        </Button>
      </div>
      <div className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {side === "left" ? panel : null}
        <div className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          controlsOpen && "invisible @min-[48rem]/canvas-workspace:visible",
        )} data-slot="canvas-content">
          {children}
        </div>
        {side === "right" ? panel : null}
      </div>
    </div>
  )
}
