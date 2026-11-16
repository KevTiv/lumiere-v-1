import { createHistoryBuckets, historyDateAt, isHistoryTimestampInRange, resolveHistoryPeriod, type HistoryPeriod } from "@lumiere/erp-shared/history-period"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"

function transferDateMs(raw: unknown): number | null {
  if (raw == null || raw === "") return null
  const value = typeof raw === "number" || typeof raw === "bigint" || typeof raw === "string"
    ? { microsSinceUnixEpoch: raw } : raw
  const micros = stbTimestampMicros(value)
  const ms = micros === null ? null : Number(micros) / 1000
  return ms !== null && Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : null
}

/** Transfer scheduling history, not a claim that scheduled moves were completed. */
export function inventoryMovementHistory(rows: readonly { scheduledDate?: unknown; pickingCode?: unknown }[], period: HistoryPeriod) {
  const dated = rows
    .filter(row => row.pickingCode === "incoming" || row.pickingCode === "outgoing")
    .map(row => ({ row, ms: transferDateMs(row.scheduledDate) }))
  const bounds = resolveHistoryPeriod(period)
  const dates = dated.flatMap(({ ms }) => ms != null && Number.isFinite(ms) ? [ms] : [])
  if (period === "all" && dates.length === 0) return []
  const lastDate = dates.length ? historyDateAt(dates.reduce((max, ms) => Math.max(max, ms), -Infinity)) : null
  const buckets = createHistoryBuckets({
    startMs: bounds.startMs ?? dates.reduce((min, ms) => Math.min(min, ms), Infinity),
    endMs: bounds.endMs ?? resolveHistoryPeriod({ kind: "custom", from: lastDate!, through: lastDate! }).endMs,
  }, { maxBuckets: 36 })
  return buckets.map(bucket => {
    let incoming = 0
    let outgoing = 0
    for (const { row, ms } of dated) {
      if (!isHistoryTimestampInRange(ms, bucket)) continue
      if (row.pickingCode === "incoming") incoming++
      else outgoing++
    }
    return { day: bucket.label, In: incoming, Out: outgoing }
  })
}
