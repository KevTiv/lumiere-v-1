/**
 * Shared parsing for form values → SpacetimeDB-friendly scalars.
 */

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

export function optionalBigIntU64(v: unknown): bigint | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'bigint') return v >= 0n ? v : undefined
  if (typeof v === 'object' && v !== null && 'some' in v) {
    return optionalBigIntU64((v as { some: unknown }).some)
  }
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  const cleaned = String(v).trim().replace(/[,_\s]/g, '')
  if (cleaned === '' || !/^\d+$/.test(cleaned)) return undefined
  try {
    return BigInt(cleaned)
  } catch {
    return undefined
  }
}

/** Parse a required non-negative integer form value, returning null when absent or invalid. */
export function nullableBigIntU64(value: unknown): bigint | null {
  return optionalBigIntU64(unwrapSome(value)) ?? null
}

/** Comma/whitespace-separated u64 ids (same convention as budget account lists). */
export function parseDelimitedU64Ids(raw: unknown): bigint[] {
  const s = String(raw ?? '').trim()
  if (!s) return []
  return s
    .split(/[\s,]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => BigInt(Math.trunc(n)))
}

/** Multi-select or comma-separated tag / id lists from forms. */
export function u64IdArrayFromForm(raw: unknown): bigint[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return raw
      .map((x) => optionalBigIntU64(x))
      .filter((x): x is bigint => x !== undefined)
  }
  return parseDelimitedU64Ids(raw)
}
