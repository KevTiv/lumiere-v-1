"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useRef, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import type { EntityInlineEdit, EntityRow } from "../lib/entity-view-types"
import { isMultilineInlineKind } from "../lib/inline-edit"
import { Input } from "../components/input"
import { Textarea } from "../components/textarea"
import { useInlineEdit } from "./use-inline-edit"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"

interface InlineEditCellProps {
  edit: EntityInlineEdit
  row: EntityRow
  columnKey: string
  label: string
  value: unknown
  children: ReactNode
}

/**
 * A table cell that turns into an input on double-click. Enter (Cmd/Ctrl+Enter for multi-line
 * kinds) or leaving the field saves, Escape cancels; an invalid or rejected value is reported and
 * the old value stays. Edit state and saving live in `useInlineEdit`.
 */
export function InlineEditCell({ edit, row, columnKey, label, value, children }: InlineEditCellProps) {
  useTranslation()
  const { canEdit, editing, draft, setDraft, pending, error, start, commit, handleKeyDown, navigationDialog } =
    useInlineEdit({ edit, row, label, value })
  // The select popup takes focus while open; that must not count as leaving the field.
  const selectOpenRef = useRef(false)

  if (!canEdit) return <>{children}</>

  if (!editing) {
    return (
      <span
        className="block cursor-text rounded-sm hover:bg-muted/50"
        title={i18n.t("ui.entityViews.inlineEditCell.doubleClickToEdit")}
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
    onKeyDown: handleKeyDown,
  }

  return (
    <>
    <span className="flex flex-col gap-1" data-testid={`entity-inline-editor-${columnKey}`}>
      <span className="flex items-center gap-1">
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
              className="h-8"
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
        ) : isMultilineInlineKind(edit.kind) ? (
          // A cell has no room for the rich editor; both multi-line kinds edit as plain text here.
          <Textarea
            {...common}
            variant="plain"
            className="min-h-16 py-1.5"
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
