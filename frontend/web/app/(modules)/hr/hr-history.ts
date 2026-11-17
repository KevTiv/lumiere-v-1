import { createHistoryBuckets, isHistoryTimestampInRange, resolveHistoryPeriod, type HistoryPeriod } from "@lumiere/erp-shared/history-period"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"

/** Query timestamps are database microseconds; unknown dates stay unknown. */
export function hrDateMs(raw: unknown): number | null {
  if (raw == null || raw === "") return null
  const value = typeof raw === "number" || typeof raw === "bigint" || typeof raw === "string"
    ? { microsSinceUnixEpoch: raw } : raw
  const micros = stbTimestampMicros(value)
  const ms = micros === null ? null : Number(micros) / 1000
  return ms !== null && Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : null
}

type EmployeeHistory = { dateHired?: unknown; dateTerminated?: unknown; isActive?: boolean }

/** Known employment intervals only. Missing hires and undated inactive employees cannot be reconstructed. */
export function headcountHistory(rows: readonly EmployeeHistory[], period: HistoryPeriod, now = Date.now()) {
  const employees = rows.flatMap(row => {
    const start = hrDateMs(row.dateHired)
    const end = hrDateMs(row.dateTerminated)
    return start == null || start > now || (!row.isActive && end == null) ? [] : [{ start, end }]
  })
  const bounds = resolveHistoryPeriod(period, { now: new Date(now) })
  if (period === "all" && employees.length === 0) return []
  const startMs = bounds.startMs ?? employees.reduce((min, e) => Math.min(min, e.start), Infinity)
  const endMs = Math.min(bounds.endMs ?? now, now)
  if (startMs >= endMs) return []
  const buckets = createHistoryBuckets({
    startMs,
    endMs,
  }, { maxBuckets: 36 })
  return buckets.map(bucket => ({
    month: bucket.label,
    Headcount: employees.filter(e => e.start < bucket.endMs && (e.end == null || e.end >= bucket.endMs)).length,
  }))
}

/** Leave usage and dated request comparisons use the leave's start, not its last edit. */
export function leaveInHistory(row: { dateFrom?: unknown }, period: HistoryPeriod) {
  return isHistoryTimestampInRange(hrDateMs(row.dateFrom), resolveHistoryPeriod(period))
}
