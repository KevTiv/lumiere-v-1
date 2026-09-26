import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type ActivityCompletionProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly state?: unknown
  readonly isDone?: unknown
  readonly is_done?: unknown
}

/** COV-19: resolve the exact completed activity from a canonical readback. */
export function resolveCompletedActivityEffect(
  rows: readonly ActivityCompletionProjection[],
  organizationId: bigint,
  activityId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === activityId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one activity, found ${matches.length}`)
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  if (row.state !== "done" || (row.isDone ?? row.is_done) !== true) return null
  return { resource: "activities", id: activityId.toString() }
}
