import type { Timestamp } from "spacetimedb"

/** Browser-side SpacetimeDB timestamp for reducer params (no `spacetimedb` runtime in the bundle). */
export function stbTimestampFromDate(d: Date): Timestamp {
  return { microsSinceUnixEpoch: BigInt(d.getTime()) * 1000n } as unknown as Timestamp
}

/** Exact STDB/ISO timestamp decoding for accounting report period boundaries. */
export function stbTimestampMicros(value: unknown): bigint | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? BigInt(value.getTime()) * 1000n : null
  if (value != null && typeof value === "object") {
    const row = value as { microsSinceUnixEpoch?: unknown; micros_since_unix_epoch?: unknown; __timestamp_micros_since_unix_epoch__?: unknown }
    const raw = row.microsSinceUnixEpoch ?? row.micros_since_unix_epoch ?? row.__timestamp_micros_since_unix_epoch__
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) return null
    if (typeof raw !== "number" && typeof raw !== "bigint" && !(typeof raw === "string" && /^-?\d+$/.test(raw))) return null
    try { return BigInt(raw) } catch { return null }
  }
  if (typeof value !== "string") return null
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value)
  if (!match) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const fraction = (match[2] ?? "").padEnd(6, "0")
  return BigInt(date.getTime()) * 1000n + BigInt(fraction.slice(3) || "0")
}

export function stbTimestampFromValue(value: unknown): Timestamp | null {
  const micros = stbTimestampMicros(value)
  return micros == null ? null : { microsSinceUnixEpoch: micros } as unknown as Timestamp
}

export function stbTimestampToExactIso(value: unknown): string | null {
  const micros = stbTimestampMicros(value)
  if (micros == null || micros < 0n) return null
  const date = new Date(Number(micros / 1000n))
  if (!Number.isFinite(date.getTime())) return null
  return `${date.toISOString().slice(0, 19)}.${String(micros % 1_000_000n).padStart(6, "0")}Z`
}
