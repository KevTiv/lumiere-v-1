import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type ScheduledReportRunProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly runCount?: unknown
  readonly run_count?: unknown
  readonly lastRun?: unknown
  readonly last_run?: unknown
}

function exactReport(
  rows: readonly ScheduledReportRunProjection[],
  organizationId: bigint,
  reportId: bigint,
): ScheduledReportRunProjection | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === reportId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one scheduled report, found ${matches.length}`)
  }
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  return row
}

/** Run count of the exact scheduled report, or null when it is not visible. */
export function scheduledReportRunCount(
  rows: readonly ScheduledReportRunProjection[],
  organizationId: bigint,
  reportId: bigint,
): number | null {
  const row = exactReport(rows, organizationId, reportId)
  if (!row) return null
  const count = Number(row.runCount ?? row.run_count)
  return Number.isInteger(count) && count >= 0 ? count : null
}

/**
 * COV-20: the recorded run is proven when the exact schedule reads back with
 * run_count advanced by exactly one and a last_run stamp.
 */
export function resolveReportRunEffect(
  rows: readonly ScheduledReportRunProjection[],
  organizationId: bigint,
  reportId: bigint,
  runCountBefore: number,
): CanonicalRecordRef | null {
  const row = exactReport(rows, organizationId, reportId)
  if (!row) return null
  const count = scheduledReportRunCount(rows, organizationId, reportId)
  if (count !== runCountBefore + 1 || (row.lastRun ?? row.last_run ?? null) == null) return null
  return { resource: "scheduled-reports", id: reportId.toString() }
}
