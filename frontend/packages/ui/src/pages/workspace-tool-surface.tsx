"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "../lib/utils"

/** Keep a single portal and editor mounted when a workspace tool changes placement. */
export function WorkspaceToolSurface({
  container,
  docked,
  label,
  onClose,
  initialFocus,
  children,
}: {
  container: HTMLElement
  docked: boolean
  label: string
  onClose: () => void
  initialFocus?: () => HTMLElement | null
  children: ReactNode
}) {
  const popup = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const focusTarget = useRef(initialFocus)
  focusTarget.current = initialFocus

  useLayoutEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) opener.current = active
  }, [])

  useLayoutEffect(() => {
    const element = popup.current
    if (!docked && element && !element.contains(document.activeElement)) {
      (focusTarget.current?.() ?? element).focus()
    }
  }, [docked])

  return (
    <Dialog.Root open modal={!docked} disablePointerDismissal onOpenChange={(open) => {
      if (!open) onClose()
    }}>
      <Dialog.Portal container={container} className={docked ? "h-full" : undefined}>
        <Dialog.Popup
          ref={popup}
          role={docked ? "region" : "dialog"}
          aria-label={label}
          aria-modal={docked ? undefined : true}
          initialFocus={() => focusTarget.current?.() ?? popup.current}
          finalFocus={() => {
            if (opener.current?.isConnected) return opener.current
            return container.parentElement?.querySelector<HTMLElement>('[data-testid="workspace-navigation-toggle"]') ?? true
          }}
          className={cn(
            "flex min-h-0 min-w-0 w-full flex-col bg-background outline-none",
            docked ? "relative h-full overflow-hidden" : "fixed inset-0 z-50 h-dvh",
          )}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
