/**
 * Shared parsing for form values → SpacetimeDB-friendly scalars.
 */

export function optionalBigIntU64(v: unknown): bigint | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'bigint') return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  try {
    return BigInt(String(v).trim())
  } catch {
    return undefined
  }
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
