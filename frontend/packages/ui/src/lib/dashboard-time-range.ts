import {
  previousHistoryPeriod,
  resolveHistoryPeriod,
  type HistoryPeriod,
  type HistoryPeriodOptions,
} from "@lumiere/erp-shared/history-period"

export type { TimeRangeValue } from "../pages/dashboard-header"

type RangeOptions = Omit<HistoryPeriodOptions, "now"> | string

/** Numeric compatibility for local filters only. Use serializeHistoryBounds for API requests. */
export function timeRangeToMs(
  range: HistoryPeriod,
  now: Date = new Date(),
  options: RangeOptions = {},
): { startMs: number; endMs: number } {
  const bounds = resolveHistoryPeriod(range, { ...(typeof options === "string" ? { timeZone: options } : options), now })
  return { startMs: bounds.startMs ?? -Infinity, endMs: bounds.endMs ?? Infinity }
}

export function previousPeriodMs(
  range: HistoryPeriod,
  now?: Date,
  options: RangeOptions = {},
): { startMs: number; endMs: number } | undefined {
  if (range === "all") return undefined
  const settings = typeof options === "string" ? { timeZone: options } : options
  const previous = previousHistoryPeriod(resolveHistoryPeriod(range, { ...settings, now }), settings.timeZone)
  return previous?.startMs != null && previous.endMs != null
    ? { startMs: previous.startMs, endMs: previous.endMs }
    : undefined
}

export function percentChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return ((current - previous) / previous) * 100
}

export function isTimestampInRange(ms: number, startMs: number, endMs: number): boolean {
  return Number.isFinite(ms) && ms >= startMs && ms < endMs
}
