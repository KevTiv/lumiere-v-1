/**
 * Named timestamp decoding adapters.
 *
 * Each adapter handles a single known timestamp representation.
 * Do not use a universal heuristic — callers must know which representation
 * their data source uses. For legacy ambiguous numeric inputs, use
 * `compatNumberToDate` which preserves the existing ms/micros threshold.
 */

/**
 * Convert microseconds since Unix epoch to a Date, or null if invalid.
 */
export function microsToDate(micros: number | bigint | string): Date | null {
  const numeric = Number(micros)
  if (!Number.isFinite(numeric)) return null
  const date = new Date(numeric / 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Convert milliseconds since Unix epoch to a Date, or null if invalid.
 */
export function millisToDate(ms: number | string): Date | null {
  const numeric = Number(ms)
  if (!Number.isFinite(numeric)) return null
  const date = new Date(numeric)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Parse an ISO 8601 string to a Date, or null if invalid.
 */
export function isoToDate(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Decode a SpacetimeDB Timestamp object to a Date.
 *
 * Accepts `microsSinceUnixEpoch` (camelCase) and
 * `micros_since_unix_epoch` (snake_case). Returns null for
 * unrecognized shapes.
 */
export function stdbTimestampToDate(raw: unknown): Date | null {
  if (raw == null) return null
  if (raw instanceof Date) return raw
  if (typeof raw === "object" && raw !== null) {
    const micros =
      (raw as { microsSinceUnixEpoch?: unknown }).microsSinceUnixEpoch ??
      (raw as { micros_since_unix_epoch?: unknown }).micros_since_unix_epoch
    if (micros != null) return microsToDate(micros as number | bigint | string)
  }
  return null
}

/**
 * Compatibility adapter for legacy ambiguous numeric timestamps.
 *
 * Disambiguates ms vs micros using a threshold (> 10_000_000_000 = micros).
 * Use only when the producer's unit is unknown; prefer named adapters
 * when the representation is known.
 */
export function compatNumberToDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return null
  const ms = numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Decode a timestamp to an ISO string.
 *
 * Tries SpacetimeDB Timestamp object first, then falls back to the
 * compatibility numeric adapter. Always returns a string (epoch ISO
 * for null/invalid) to match the existing audit-log contract.
 */
export function timestampToIso(raw: unknown): string {
  const date = stdbTimestampToDate(raw) ?? compatNumberToDate(raw)
  return (date ?? new Date(0)).toISOString()
}
