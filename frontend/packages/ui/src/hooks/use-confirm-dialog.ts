"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@lumiere/ui/components/alert-dialog"

export type ConfirmDialogOptions = {
  title?: React.ReactNode
  description: React.ReactNode
  confirmLabel?: React.ReactNode
  cancelLabel?: React.ReactNode
}

const testId = (id: string) => ({ "data-testid": id }) as unknown as Record<string, never>

type Pending = { options: ConfirmDialogOptions; resolve: (ok: boolean) => void }

/**
 * In-app replacement for window.confirm. `confirm(options)` resolves true when the
 * user confirms and false on cancel/dismiss. Render `dialog` once in the component tree.
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  dialog: React.ReactNode
} {
  const [pending, setPending] = React.useState<Pending | null>(null)
  const pendingRef = React.useRef<Pending | null>(null)
  pendingRef.current = pending

  const confirm = React.useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        setPending({ options, resolve })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setPending(null)
    current.resolve(ok)
  }

  const options = pending?.options
  const dialog = React.createElement(
    AlertDialog,
    { open: pending != null, onOpenChange: (open: boolean) => !open && settle(false) },
    React.createElement(
      AlertDialogContent,
      testId("confirm-dialog"),
      React.createElement(
        AlertDialogHeader,
        null,
        options?.title != null ? React.createElement(AlertDialogTitle, null, options.title) : null,
        React.createElement(AlertDialogDescription, null, options?.description),
      ),
      React.createElement(
        AlertDialogFooter,
        null,
        React.createElement(
          AlertDialogCancel,
          { ...testId("confirm-dialog-cancel"), onClick: () => settle(false) },
          options?.cancelLabel ?? "Cancel",
        ),
        React.createElement(
          AlertDialogAction,
          { ...testId("confirm-dialog-confirm"), onClick: () => settle(true) },
          options?.confirmLabel ?? "Confirm",
        ),
      ),
    ),
  )

  return { confirm, dialog }
}
