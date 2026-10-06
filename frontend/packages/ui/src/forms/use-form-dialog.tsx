"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"
import type { FormConfig, FormField } from "../lib/form-types"
import { FormModal } from "./form-modal"

type FormValues = Record<string, unknown>

/**
 * Promise-based form dialog for one-off actions that need a few inputs.
 * Replaces chains of `window.prompt` with the app's normal form modal:
 *
 *   const { askForm, formDialog } = useFormDialog()
 *   const values = await askForm({ title: "Update variant", fields: [...] })
 *   if (!values) return // cancelled
 *
 * Render `formDialog` once in the component.
 */
export function useFormDialog(): {
  askForm: (request: FormDialogRequest) => Promise<FormValues | null>
  formDialog: ReactNode
} {
  const [active, setActive] = useState<FormDialogRequest | null>(null)
  const resolverRef = useRef<((values: FormValues | null) => void) | null>(null)

  const settle = useCallback((values: FormValues | null) => {
    resolverRef.current?.(values)
    resolverRef.current = null
    setActive(null)
  }, [])

  const askForm = useCallback(
    (request: FormDialogRequest) =>
      new Promise<FormValues | null>((resolve) => {
        resolverRef.current?.(null)
        resolverRef.current = resolve
        setActive(request)
      }),
    [],
  )

  const formDialog = active ? (
    <FormModal
      open
      onOpenChange={(open) => {
        if (!open) settle(null)
      }}
      config={toFormConfig(active)}
      showSubmitSuccessToast={false}
      onSubmit={(values) => settle(values)}
    />
  ) : null

  return { askForm, formDialog }
}

export interface FormDialogRequest {
  id?: string
  title: string
  description?: string
  submitLabel?: string
  fields: FormField[]
}

function toFormConfig(request: FormDialogRequest): FormConfig {
  return {
    id: request.id ?? "form-dialog",
    // Button labels end in "…" to signal a dialog; the dialog title should not.
    title: request.title.replace(/\s*(…|\.\.\.)$/, ""),
    description: request.description,
    submitLabel: request.submitLabel,
    sections: [{ id: "main", fields: request.fields }],
  }
}

/** Optional numeric value from a form submission ("" → undefined). */
export function formNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** Optional trimmed text from a form submission ("" → undefined). */
export function formText(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text === "" ? undefined : text
}

/** Select options for picking a record by name instead of typing its id. */
export function recordOptions<T>(
  rows: readonly T[],
  label: (row: T) => string,
  id: (row: T) => unknown = (row) => (row as { id?: unknown }).id,
): Array<{ value: string; label: string }> {
  return rows
    .map((row) => ({ value: String(id(row) ?? ""), label: label(row) }))
    .filter((option) => option.value !== "")
}
