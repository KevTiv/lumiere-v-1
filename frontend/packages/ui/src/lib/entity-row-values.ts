/** Pure entity-display adapters; no component imports are needed to test them. */
import {
  firstOwnedKey,
  toCamelCase,
  toSnakeCase,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"
import { isoToDate, millisToDate } from "@lumiere/erp-shared/timestamp-values"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export function getRowField(row: RowValueMap, key: string): unknown {
  // Entity config historically accepts PascalCase keys as well as camelCase.
  return firstOwnedKey(row, key, toSnakeCase(key).replace(/^_/, ""), toCamelCase(key))
}

export function formatTimestampLike(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "number") return millisToDate(value)
  if (typeof value === "string") return isoToDate(value)
  if (value != null && typeof value === "object" && "microsSinceUnixEpoch" in value) {
    try {
      // Preserve integer division before conversion: converting large micros to
      // Number first can round across a millisecond boundary.
      const micros = BigInt(String(value.microsSinceUnixEpoch))
      return millisToDate(Number(micros / 1000n))
    } catch {
      return null
    }
  }
  return null
}

/**
 * Unwrap SpacetimeDB wire shapes for display: `{ tag }` enums become their
 * tag, `{ some: v }` becomes `v`, `{ none }` becomes null. Other values pass
 * through unchanged (timestamps are handled by the formatters).
 */
export function unwrapEntityValue(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    return value
  }
  if ("tag" in value && typeof value.tag === "string") return value.tag
  if ("some" in value) return unwrapEntityValue(value.some)
  if ("none" in value) return null
  return value
}

/** Read an enum from a generated tag, a string projection, or a SATS unit variant. */
export function entityEnumTag(value: unknown): string | null {
  const raw = unwrapEntityValue(value)
  if (typeof raw === "string") return raw.trim() || null
  if (raw == null || typeof raw !== "object" || Array.isArray(raw) || "tag" in raw) return null
  const entries = Object.entries(raw)
  if (entries.length !== 1) return null
  const [key, payload] = entries[0]!
  const unit = Array.isArray(payload) ? payload.length === 0 :
    payload != null && typeof payload === "object" && Object.keys(payload).length === 0
  return unit && /^[A-Za-z][A-Za-z0-9_]*$/.test(key)
    ? key.charAt(0).toUpperCase() + key.slice(1)
    : null
}

/** Render scalar data without inventing an identifier or coercing objects to text. */
export function entityScalarText(value: unknown): string | null {
  const raw = unwrapEntityValue(value)
  if (typeof raw === "string") return raw.trim() || null
  if (typeof raw === "bigint" || typeof raw === "boolean" ||
    (typeof raw === "number" && Number.isFinite(raw))) return String(raw)
  return null
}

/** Resolve a numeric relation through its saved label, then its live label, then its exact ID. */
export function formatEntityReference(
  id: unknown,
  options?: {
    label?: string | null
    labels?: ReadonlyMap<string, string>
    formatId?: (id: string) => string
    missing?: string
  },
): string {
  const savedLabel = options?.label?.trim()
  if (savedLabel) return savedLabel
  const key = parseStrictU64(id)?.toString()
  if (key == null) return options?.missing ?? "—"
  return options?.labels?.get(key)?.trim() || options?.formatId?.(key) || `#${key}`
}

/** Readable label for an internal enum/status value: "in_progress" → "In progress". */
export function humanizeEnumValue(raw: string): string {
  // Leave acronyms (USD, POS) and already-readable labels ("Over-billed") alone.
  if (/^[A-Z0-9]+$/.test(raw) || /\s/.test(raw)) return raw
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .trim()
    .toLowerCase()
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : raw
}

/** Plain-text fallback for a value with no specific column type. */
export function displayEntityValue(value: unknown): string {
  const unwrapped = unwrapEntityValue(value)
  if (unwrapped == null) return ""
  if (typeof unwrapped !== "object") return String(unwrapped)
  const date = formatTimestampLike(unwrapped)
  if (date) return date.toLocaleString()
  return JSON.stringify(unwrapped)
}

export type StatusTone = "success" | "warning" | "info" | "destructive" | "secondary"

const STATUS_TONES: ReadonlyArray<readonly [StatusTone, readonly string[]]> = [
  ["destructive", ["cancelled", "canceled", "rejected", "failed", "error", "overdue", "lost", "blocked", "refused", "void"]],
  ["secondary", ["archived", "closed", "inactive", "expired", "retired", "disabled"]],
  ["warning", ["draft", "pending", "waiting", "in progress", "partial", "partially", "review", "to approve", "on hold", "not paid", "unpaid", "open"]],
  ["info", ["new", "sent", "scheduled", "submitted", "quotation", "assigned", "ready"]],
  ["success", ["done", "paid", "posted", "completed", "complete", "active", "won", "confirmed", "delivered", "approved", "sale", "received", "reconciled", "validated", "in payment"]],
]

/**
 * Semantic tone for a status value, so the same word reads the same colour in
 * every module. Returns null for unknown values (callers keep their config).
 */
export function statusTone(raw: string): StatusTone | null {
  const label = humanizeEnumValue(raw).toLowerCase()
  for (const [tone, words] of STATUS_TONES) {
    if (words.includes(label)) return tone
  }
  return null
}
