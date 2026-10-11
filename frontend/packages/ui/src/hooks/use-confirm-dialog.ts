"use client"

import * as React from "react"
import { useTranslation } from "@lumiere/i18n"

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
  dismiss: () => void
  dialog: React.ReactNode
} {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState<Pending | null>(null)
  const pendingRef = React.useRef<Pending | null>(null)

  React.useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
  }, [])

  const confirm = React.useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        const next = { options, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const settle = React.useCallback((ok: boolean) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    setPending(null)
    current.resolve(ok)
  }, [])
  const dismiss = React.useCallback(() => settle(false), [settle])

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
        React.createElement(AlertDialogTitle, null, options?.title ?? t("common.confirmAction", { defaultValue: "Confirm action" })),
        React.createElement(AlertDialogDescription, null, options?.description),
      ),
      React.createElement(
        AlertDialogFooter,
        null,
        React.createElement(
          AlertDialogCancel,
          { ...testId("confirm-dialog-cancel"), onClick: () => settle(false) },
          options?.cancelLabel ?? t("common.cancel", { defaultValue: "Cancel" }),
        ),
        React.createElement(
          AlertDialogAction,
          { ...testId("confirm-dialog-confirm"), onClick: () => settle(true) },
          options?.confirmLabel ?? t("common.confirm", { defaultValue: "Confirm" }),
        ),
      ),
    ),
  )

  return { confirm, dismiss, dialog }
}
