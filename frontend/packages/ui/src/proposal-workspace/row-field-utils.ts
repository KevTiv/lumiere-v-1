/** Coerce `Record<string, unknown>` API rows for UI (typed children, events). */

export function rowString(v: unknown, fallback = ""): string {
  if (v == null) return fallback
  return String(v)
}

export function rowNumber(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function rowBool(v: unknown): boolean {
  return Boolean(v)
}

export function rowBigint(v: unknown): bigint {
  if (typeof v === "bigint") return v
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v))
  const s = String(v ?? "").trim()
  if (!s) return BigInt(0)
  return BigInt(s)
}
