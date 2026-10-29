import { i18n as uiI18n } from "@lumiere/i18n"
import type { EntityInlineEdit } from "./entity-view-types"

export type InlineParse = { ok: true; value: string | number } | { ok: false; error: string }

/** Turns what was typed into the value to save, or says why it cannot be saved. */
export function parseInlineValue(kind: EntityInlineEdit["kind"], raw: string): InlineParse {
  const text = raw.trim()
  if (kind === "number") {
    if (text === "") return { ok: false, error: uiI18n.t("common.inlineEdit.enterNumber", { defaultValue: "Enter a number" }) }
    const value = Number(text)
    if (!Number.isFinite(value)) return { ok: false, error: uiI18n.t("common.inlineEdit.enterNumber", { defaultValue: "Enter a number" }) }
    return { ok: true, value }
  }
  if (isMultilineInlineKind(kind)) return { ok: true, value: raw.replace(/\s+$/, "") }
  return { ok: true, value: kind === "text" ? text : raw }
}

/** Kinds where Enter inserts a newline and Cmd/Ctrl+Enter saves. */
export function isMultilineInlineKind(kind: EntityInlineEdit["kind"]): boolean {
  return kind === "textarea" || kind === "markdown"
}

/** True when saving would change nothing, so no command should be sent. */
export function isUnchangedInline(current: unknown, next: string | number): boolean {
  if (current == null) return next === "" || next === 0 ? current == null && next === "" : false
  return String(current) === String(next)
}
