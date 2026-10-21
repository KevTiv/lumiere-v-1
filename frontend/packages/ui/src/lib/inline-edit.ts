import type { EntityInlineEdit } from "./entity-view-types"

export type InlineParse = { ok: true; value: string | number } | { ok: false; error: string }

/** Turns what was typed into the value to save, or says why it cannot be saved. */
export function parseInlineValue(kind: EntityInlineEdit["kind"], raw: string): InlineParse {
  const text = raw.trim()
  if (kind === "number") {
    if (text === "") return { ok: false, error: "Enter a number" }
    const value = Number(text)
    if (!Number.isFinite(value)) return { ok: false, error: "Enter a number" }
    return { ok: true, value }
  }
  return { ok: true, value: kind === "text" ? text : raw }
}

/** True when saving would change nothing, so no command should be sent. */
export function isUnchangedInline(current: unknown, next: string | number): boolean {
  if (current == null) return next === "" || next === 0 ? current == null && next === "" : false
  return String(current) === String(next)
}
