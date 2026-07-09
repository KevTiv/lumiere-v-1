import type { TimeRangeValue } from "../pages/dashboard-header"

export type { TimeRangeValue } from "../pages/dashboard-header"

export function timeRangeToMs(
  range: TimeRangeValue,
  now: Date = new Date(),
): { startMs: number; endMs: number } {
  const endMs = now.getTime()

  switch (range) {
    case "today": {
      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      return { startMs, endMs }
    }
    case "7d":
      return { startMs: endMs - 7 * 24 * 60 * 60 * 1000, endMs }
    case "30d":
      return { startMs: endMs - 30 * 24 * 60 * 60 * 1000, endMs }
    case "90d":
      return { startMs: endMs - 90 * 24 * 60 * 60 * 1000, endMs }
    case "ytd":
      return { startMs: new Date(now.getFullYear(), 0, 1).getTime(), endMs }
  }
}

export function previousPeriodMs(
  range: TimeRangeValue,
  now?: Date,
): { startMs: number; endMs: number } {
  const { startMs, endMs } = timeRangeToMs(range, now)
  const duration = endMs - startMs
  return { startMs: startMs - duration, endMs: startMs }
}

export function percentChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined
  return ((current - previous) / previous) * 100
}

export function isTimestampInRange(ms: number, startMs: number, endMs: number): boolean {
  return ms >= startMs && ms <= endMs
}
