import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"

/** Normalize a SpacetimeDB enum JSON value (string, `{tag}` or single-key object) to its variant name. */
export function variantTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const tag = (value as { tag?: unknown }).tag
    if (typeof tag === "string") return tag
    const keys = Object.keys(value as object)
    if (keys.length === 1 && keys[0]) return keys[0]
  }
  return String(value)
}

/** Record id of a row as the string used in refs and action inputs. */
export function rowId(row: RowValueMap): string {
  return String(firstNonNullKey(row, "id") ?? "")
}

/** Case- and separator-insensitive enum tag (`OutInvoice`, `out_invoice`, `{tag}` all compare equal). */
export function normalizedTag(value: unknown): string {
  return variantTag(value).replace(/_/g, "").toLowerCase()
}
