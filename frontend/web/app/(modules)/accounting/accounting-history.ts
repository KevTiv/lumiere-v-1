import { createHistoryBuckets, resolveHistoryPeriod, type HistoryBounds, type HistoryPeriod } from "@lumiere/erp-shared/history-period"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import type { AccountantOverviewData } from "./accountant-overview-model"

export function accountingTimeZone(data: AccountantOverviewData): string {
  const zone = data.timeZone
  if (typeof zone === "string") {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone } catch { /* Explicit UTC fallback. */ }
  }
  return "UTC"
}

/** Accounting date columns encode source-calendar dates at UTC midnight in STDB.
 * Decode the UTC date first, then resolve its midnight in the reporting timezone.
 * Never interpret a stored date as an instant in a negative-offset viewer zone. */
export function accountingDate(value: unknown, timeZone: string): number | null {
  const micros = stbTimestampMicros(value)
  // BigInt division truncates toward zero; source dates before epoch require floor.
  const ms = micros === null ? null : micros / 1000n - (micros < 0n && micros % 1000n !== 0n ? 1n : 0n)
  const decoded = ms === null ? null : new Date(Number(ms))
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value : decoded && Number.isFinite(decoded.getTime()) ? decoded.toISOString().slice(0, 10) : null
  if (!date) return null
  try { return resolveHistoryPeriod({ kind: "custom", from: date, through: date }, { timeZone }).startMs } catch { return null }
}

/** All includes every dated historical row through now; future postings never become history.
 * Observed extents are for chart layout only, not a claim about authoritative source coverage. */
export function accountingHistory(period: HistoryPeriod, now: Date, timeZone: string, dates: readonly number[]) {
  const bounds = resolveHistoryPeriod(period, { now, timeZone })
  const historical = dates.filter((date) => Number.isFinite(date) && date <= now.getTime())
  const chartBounds: HistoryBounds = {
    startMs: bounds.startMs ?? historical.reduce<number | null>((earliest, date) => earliest === null ? date : Math.min(earliest, date), null),
    endMs: bounds.endMs === null ? (historical.length ? now.getTime() + 1 : null) : Math.min(bounds.endMs, now.getTime() + 1),
  }
  const buckets = chartBounds.startMs !== null && chartBounds.endMs !== null && chartBounds.startMs < chartBounds.endMs
    ? createHistoryBuckets(chartBounds, { timeZone, maxBuckets: 24 }) : []
  const contains = (date: number) => date <= now.getTime() && (bounds.startMs === null || date >= bounds.startMs) && (bounds.endMs === null || date < bounds.endMs)
  return { bounds, buckets, contains }
}
