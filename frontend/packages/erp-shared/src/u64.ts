/**
 * Strict u64 ID parsing for browser/form values.
 *
 * Parses integer strings directly to `BigInt` (never through `Number`) so
 * values above 2^53 survive unchanged.  Validates `0 <= n <= 2^64 - 1`.
 * Absent values (null / undefined / empty string) return `undefined`;
 * invalid values (negative, fractional, out of range, non-numeric) also
 * return `undefined` for the optional parser or throw for the required one.
 *
 * Keep this distinct from generated transport codecs — those own wire types.
 */

const U64_MAX = 18446744073709551615n

/** Accepted scalar ID input types for strict conversion. */
export type ScalarId = bigint | number | string

/** Unwrap the wire representation of `Option::Some`, leaving every other value intact. */
function unwrapSome(value: unknown): unknown {
  if (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "some")
  ) {
    return (value as { some: unknown }).some
  }
  return value
}

/**
 * Parse a form/wire value to a non-negative u64 `bigint`.
 * Returns `undefined` for absent or invalid values.
 * Handles `Option::Some` envelopes.
 */
export function parseStrictU64(v: unknown): bigint | undefined {
  if (v == null || v === "") return undefined
  if (typeof v === "bigint") return v >= 0n && v <= U64_MAX ? v : undefined
  if (typeof v === "object") {
    return parseStrictU64(unwrapSome(v))
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return undefined
    if (!Number.isSafeInteger(v)) return undefined
    return BigInt(v)
  }
  // string path — parse directly to BigInt, never through Number
  const cleaned = String(v).trim().replace(/[,_\s]/g, "")
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return undefined
  try {
    const n = BigInt(cleaned)
    return n >= 0n && n <= U64_MAX ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * Convert a known scalar ID (`bigint | number | string`) to `bigint`.
 * Throws on absent, invalid, or out-of-range values — use for required IDs
 * where absent is a programming error, not a form edge case.
 */
export function scalarToU64(v: bigint | number | string): bigint {
  if (typeof v === "bigint") {
    if (v < 0n || v > U64_MAX)
      throw new RangeError(`u64 out of range: ${v}`)
    return v
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0)
      throw new RangeError(`u64 out of range: ${v}`)
    return BigInt(v)
  }
  const s = String(v).trim()
  if (s === "") throw new RangeError("u64 value is empty")
  const n = BigInt(s)
  if (n < 0n || n > U64_MAX)
    throw new RangeError(`u64 out of range: ${n}`)
  return n
}

/** Comma/whitespace-separated u64 ids (same convention as budget account lists). */
export function parseDelimitedU64Ids(raw: unknown): bigint[] {
  const s = String(raw ?? "").trim()
  if (!s) return []
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .map((x) => parseStrictU64(x))
    .filter((x): x is bigint => x !== undefined)
}
