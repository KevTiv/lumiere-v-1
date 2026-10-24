"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"

import type { EntityInlineEdit, EntityRow } from "../lib/entity-view-types"
import { isMultilineInlineKind, isUnchangedInline, parseInlineValue } from "../lib/inline-edit"
import { showWorkflowToast } from "../lib/workflow-toast"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

interface UseInlineEditOptions {
  edit: EntityInlineEdit
  row: EntityRow
  label: string
  value: unknown
  /**
   * After a successful save, show the saved value right away and offer an Undo toast that writes
   * the previous value back.
   */
  undoable?: boolean
}

interface InlineEditKeyEvent {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

export interface InlineEditState {
  /** False when the edit's `canEdit` rejects the row: render the value read-only. */
  canEdit: boolean
  editing: boolean
  draft: string
  setDraft: (next: string) => void
  pending: boolean
  error: string | null
  /** The value to display: the last saved value until the record catches up, else `value`. */
  current: unknown
  start: () => void
  cancel: () => void
  commit: (next?: string) => Promise<void>
  /** Enter saves (Cmd/Ctrl+Enter for multi-line kinds), Escape cancels. */
  handleKeyDown: (event: InlineEditKeyEvent) => void
  /** Unsaved-changes dialog to render while editing. */
  navigationDialog: ReactNode
}

function toSaveValue(value: unknown): string | number {
  if (typeof value === "number") return value
  return value == null ? "" : String(value)
}

/** Edit state and save/undo logic shared by the table cell and the record detail field. */
export function useInlineEdit({ edit, row, label, value, undoable = false }: UseInlineEditOptions): InlineEditState {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ value: string | number } | null>(null)
  // Blur and Enter can both ask to save the same edit; only the first one may.
  const editingRef = useRef(false)
  const busyRef = useRef(false)

  // The record changed underneath (refetch caught up, or someone else edited it): show it as is.
  const valueKey = value == null ? "" : String(value)
  useEffect(() => {
    setSaved(null)
  }, [valueKey])

  const current = saved ? saved.value : value
  const navigationDialog = useUnsavedChangesGuard(editing && draft !== String(current ?? ""), pending)
  const canEdit = !edit.canEdit || edit.canEdit(row)

  const notSaved = (caught: unknown) =>
    showWorkflowToast({
      kind: "error",
      title: t("common.entityView.inlineEdit.notSaved", { label, defaultValue: "{{label}} was not saved" }),
      description: caught instanceof Error ? caught.message : String(caught),
    })

  const finish = () => {
    editingRef.current = false
    setEditing(false)
    setError(null)
  }

  const start = () => {
    setDraft(current == null ? "" : String(current))
    setError(null)
    editingRef.current = true
    setEditing(true)
  }

  const undo = async (previous: string | number) => {
    try {
      await edit.save(row, previous)
      setSaved({ value: previous })
      showWorkflowToast({
        kind: "info",
        title: t("common.entityView.inlineEdit.undone", { label, defaultValue: "{{label}} change undone" }),
      })
    } catch (caught) {
      notSaved(caught)
    }
  }

  const commit = async (next: string = draft) => {
    if (!editingRef.current || busyRef.current) return
    const parsed = parseInlineValue(edit.kind, next)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (isUnchangedInline(current, parsed.value)) {
      finish()
      return
    }
    const previous = toSaveValue(current)
    busyRef.current = true
    setPending(true)
    try {
      await edit.save(row, parsed.value)
      finish()
      if (undoable) {
        setSaved({ value: parsed.value })
        showWorkflowToast({
          kind: "success",
          title: t("common.entityView.inlineEdit.saved", { label, defaultValue: "{{label}} updated" }),
          action: {
            label: t("common.entityView.inlineEdit.undo", { defaultValue: "Undo" }),
            onClick: () => void undo(previous),
          },
        })
      }
    } catch (caught) {
      finish()
      notSaved(caught)
    } finally {
      busyRef.current = false
      setPending(false)
    }
  }

  const handleKeyDown = (event: InlineEditKeyEvent) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      // Multi-line kinds keep plain Enter for a newline.
      if (isMultilineInlineKind(edit.kind) && !event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      void commit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      finish()
    }
  }

  return {
    canEdit,
    editing,
    draft,
    setDraft,
    pending,
    error,
    current,
    start,
    cancel: finish,
    commit,
    handleKeyDown,
    navigationDialog,
  }
}
