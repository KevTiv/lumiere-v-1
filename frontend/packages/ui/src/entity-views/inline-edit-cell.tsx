"use client"

import { useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import type { EntityInlineEdit, EntityRow } from "../lib/entity-view-types"
import { isUnchangedInline, parseInlineValue } from "../lib/inline-edit"
import { showWorkflowToast } from "../lib/workflow-toast"
import { Input } from "../components/input"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

interface InlineEditCellProps {
  edit: EntityInlineEdit
  row: EntityRow
  columnKey: string
  label: string
  value: unknown
  children: ReactNode
}

/**
 * A table cell that turns into an input on double-click. Enter or leaving the field saves, Escape
 * cancels; an invalid or rejected value is reported and the old value stays.
 */
export function InlineEditCell({ edit, row, columnKey, label, value, children }: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigationDialog = useUnsavedChangesGuard(editing && draft !== String(value ?? ""), pending)

  if (edit.canEdit && !edit.canEdit(row)) return <>{children}</>

  const start = () => {
    setDraft(value == null ? "" : String(value))
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
  }

  const commit = async () => {
    if (pending) return
    const parsed = parseInlineValue(edit.kind, draft)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (isUnchangedInline(value, parsed.value)) {
      cancel()
      return
    }
    setPending(true)
    try {
      await edit.save(row, parsed.value)
      setEditing(false)
    } catch (caught) {
      setEditing(false)
      showWorkflowToast({
        kind: "error",
        title: `${label} was not saved`,
        description: caught instanceof Error ? caught.message : String(caught),
      })
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <span
        className="block cursor-text rounded-sm hover:bg-muted/50"
        title="Double-click to edit"
        data-testid={`entity-inline-${columnKey}`}
        onDoubleClick={(event) => {
          event.stopPropagation()
          start()
        }}
      >
        {children}
      </span>
    )
  }

  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    disabled: pending,
    autoFocus: true,
    onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onBlur: () => void commit(),
    onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
      event.stopPropagation()
      if (event.key === "Enter") {
        event.preventDefault()
        void commit()
      } else if (event.key === "Escape") {
        event.preventDefault()
        cancel()
      }
    },
  }

  return (
    <>
    <span className="flex flex-col gap-1" data-testid={`entity-inline-editor-${columnKey}`}>
      <span className="flex items-center gap-1">
        {edit.kind === "select" ? (
          <select
            {...common}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          >
            {edit.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            {...common}
            className="h-8"
            type={edit.kind === "number" ? "number" : "text"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        )}
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </span>
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </span>
    {navigationDialog}
    </>
  )
}
