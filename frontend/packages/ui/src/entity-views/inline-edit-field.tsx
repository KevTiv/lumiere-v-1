"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { Loader2, Pencil } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"

import type { EntityInlineEdit, EntityRow } from "../lib/entity-view-types"
import { isMultilineInlineKind } from "../lib/inline-edit"
import { Input } from "../components/input"
import { Textarea } from "../components/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { useInlineEdit } from "./use-inline-edit"

interface InlineEditFieldProps {
  edit: EntityInlineEdit
  record: EntityRow
  fieldKey: string
  label: string
  value: unknown
  /** How the value reads when not editing (the detail view's usual formatting). */
  renderValue: (value: unknown) => ReactNode
}

/** True when focus moved into a popup the editor opened (e.g. the rich editor's link popover). */
function focusInPopup(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement
  return Boolean(active?.closest("[data-radix-popper-content-wrapper]"))
}

/**
 * A record detail value that is edited where it is read: click it (or press Enter/Space on it) to
 * edit. Single-line kinds save on Enter or blur; `textarea` and `markdown` keep Enter for newlines
 * and save on Cmd/Ctrl+Enter or blur. Escape cancels. A save offers Undo.
 */
export function InlineEditField({ edit, record, fieldKey, label, value, renderValue }: InlineEditFieldProps) {
  const { t } = useTranslation()
  const state = useInlineEdit({ edit, row: record, label, value, undoable: true })
  const { editing, draft, setDraft, pending, error, commit, handleKeyDown } = state
  const editorRef = useRef<HTMLDivElement | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The select popup takes focus while open; that must not count as leaving the field.
  const selectOpenRef = useRef(false)
  const multiline = isMultilineInlineKind(edit.kind)

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    },
    [],
  )

  if (!state.canEdit) return <>{renderValue(value)}</>

  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={t("common.entityView.inlineEdit.edit", { label, defaultValue: "Edit {{label}}" })}
        data-testid={`entity-detail-edit-${fieldKey}`}
        className="group/inline-edit -mx-1.5 flex min-h-7 cursor-text items-start gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={(event) => {
          // Links inside the value keep working.
          if (event.target instanceof Element && event.target.closest("a")) return
          state.start()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            state.start()
          }
        }}
      >
        <div className="min-w-0 flex-1">{renderValue(state.current)}</div>
        <Pencil
          aria-hidden="true"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-100 group-focus-visible/inline-edit:opacity-100"
        />
      </div>
    )
  }

  const common = {
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    disabled: pending,
    autoFocus: true,
    onKeyDown: handleKeyDown,
  }

  // The rich editor moves focus between its own parts (and reports blur twice), so a multi-line
  // field only saves once focus has settled outside it.
  const onEditorBlur = multiline
    ? () => {
        if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
        blurTimerRef.current = setTimeout(() => {
          blurTimerRef.current = null
          const inside = editorRef.current?.contains(document.activeElement ?? null)
          if (!inside && !focusInPopup()) void commit()
        }, 0)
      }
    : undefined

  const shortcut =
    typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform ?? "") ? "⌘↵" : "Ctrl+↵"

  return (
    <>
      <div
        ref={editorRef}
        className="flex flex-col gap-1"
        data-testid={`entity-detail-editor-${fieldKey}`}
        onBlur={onEditorBlur}
      >
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            {edit.kind === "select" ? (
              <Select
                value={draft}
                onValueChange={(next) => {
                  setDraft(next)
                  void commit(next)
                }}
                onOpenChange={(open) => {
                  selectOpenRef.current = open
                }}
              >
                <SelectTrigger
                  {...common}
                  className="h-8 w-full"
                  onBlur={() => {
                    if (!selectOpenRef.current) void commit()
                  }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {edit.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : edit.kind === "textarea" ? (
              <Textarea
                {...common}
                variant="plain"
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            ) : edit.kind === "markdown" ? (
              <Textarea
                {...common}
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            ) : (
              <Input
                {...common}
                className="h-8"
                type={edit.kind === "number" ? "number" : "text"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void commit()}
              />
            )}
          </div>
          {pending ? <Loader2 className="mt-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : null}
        </div>
        {multiline ? (
          <span className="text-xs text-muted-foreground">
            {t("common.entityView.inlineEdit.saveHint", {
              shortcut,
              defaultValue: "Press {{shortcut}} to save, Esc to cancel",
            })}
          </span>
        ) : null}
        {error ? (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      {state.navigationDialog}
    </>
  )
}
