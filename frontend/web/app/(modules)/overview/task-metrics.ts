import { moduleHistoryTimestampMs } from "@lumiere/ui/lib/module-history-filter"
import { unwrapEntityValue } from "@lumiere/ui/lib/entity-row-values"
import type { OverviewResourceStatus } from "./resource-state"

/** Fields required by the Overview's company-scoped task figures. */
export interface OverviewTaskRow {
  isClosed?: unknown
  is_closed?: unknown
  dateDeadline?: unknown
  date_deadline?: unknown
}

export interface OverviewTaskMetrics {
  openCount: number | null
  overdueCount: number | null
}

/** Unknown fields or unavailable reads cannot become reassuring zero counts. */
export function overviewTaskMetrics(
  rows: readonly OverviewTaskRow[],
  sourceStatus: OverviewResourceStatus,
  nowMs = Date.now(),
): OverviewTaskMetrics {
  if (sourceStatus !== "ready" && sourceStatus !== "empty") return { openCount: null, overdueCount: null }
  if (sourceStatus === "empty" && rows.length > 0) return { openCount: null, overdueCount: null }

  const closedOf = (row: OverviewTaskRow) => Object.hasOwn(row, "isClosed") ? row.isClosed : row.is_closed
  if (rows.some((row) => typeof closedOf(row) !== "boolean")) return { openCount: null, overdueCount: null }
  const open = rows.filter((row) => closedOf(row) === false)
  let overdue = 0
  if (!Number.isFinite(nowMs)) return { openCount: open.length, overdueCount: null }
  for (const row of open) {
    const hasCamel = Object.hasOwn(row, "dateDeadline")
    if (!hasCamel && !Object.hasOwn(row, "date_deadline")) return { openCount: open.length, overdueCount: null }
    const raw = unwrapEntityValue(hasCamel ? row.dateDeadline : row.date_deadline)
    // A recorded absence is complete; a missing/redacted or invalid field is not.
    if (raw === null) continue
    const deadlineMs = moduleHistoryTimestampMs(raw, "UTC")
    if (deadlineMs == null) return { openCount: open.length, overdueCount: null }
    if (deadlineMs < nowMs) overdue += 1
  }
  return { openCount: open.length, overdueCount: overdue }
}
