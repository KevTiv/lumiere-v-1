import { formatTimestampLike } from "./entity-row-values"

/** File cards and record tables share the same date shape and selected locale. */
export function formatFileDate(value: unknown, locale?: string): string {
  const date = formatTimestampLike(value)
  return date
    ? date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
    : "—"
}
