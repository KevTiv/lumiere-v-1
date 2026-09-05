/**
 * Shared parsing for form values → SpacetimeDB-friendly scalars.
 *
 * Strict u64 ID parsing lives in `./u64` — this file re-exports compatibility
 * entry points so existing callers don't break.
 */

import { parseStrictU64, parseDelimitedU64Ids } from "./u64"

export { parseStrictU64, scalarToU64, parseDelimitedU64Ids } from "./u64"

/** Unwrap the wire representation of `Option::Some`, leaving every other value intact. */
export function unwrapSome(value: unknown): unknown {
  if (
    value != null &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "some")
  ) {
    return (value as { some: unknown }).some
  }
  return value
}

/** Trim a form value, treating blank and absent values as undefined. */
export function optionalTrimmedString(value: unknown): string | undefined {
  const unwrapped = unwrapSome(value)
  if (unwrapped == null) return undefined
  const trimmed = String(unwrapped).trim()
  return trimmed === "" ? undefined : trimmed
}

/** Read the first present form value, supporting camelCase and snake_case fields. */
export function formValue(formData: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = formData[key]
    if (value != null) return value
  }
  return undefined
}

/** Parse an optional non-negative u64 form value. Returns undefined when absent or invalid. */
export function optionalBigIntU64(v: unknown): bigint | undefined {
  return parseStrictU64(v)
}

/** Parse a required non-negative integer form value, returning null when absent or invalid. */
export function nullableBigIntU64(value: unknown): bigint | null {
  return parseStrictU64(unwrapSome(value)) ?? null
}

/** Multi-select or comma-separated tag / id lists from forms. */
export function u64IdArrayFromForm(raw: unknown): bigint[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return raw
      .map((x) => parseStrictU64(x))
      .filter((x): x is bigint => x !== undefined)
  }
  return parseDelimitedU64Ids(raw)
}
