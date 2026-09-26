import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type HrLeaveStateTag = "Draft" | "Confirm" | "ValidatedOne" | "Validated" | "Refused"

export type HrLeaveEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}

/** Normalise a SATS enum cell (`"Confirm"`, `{ tag: "Confirm" }`, `{ confirm: [] }`). */
export function hrLeaveStateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const record = state as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

/**
 * COV-09: resolve the same leave id, in the same organization and company, in
 * one of the `expected` states. Approval may land in `ValidatedOne` (first of
 * two approvals) or `Validated`, so callers pass every acceptable state.
 */
export function resolveLeaveStateEffect(
  rows: readonly HrLeaveEffectProjection[],
  organizationId: bigint,
  companyId: bigint,
  leaveId: bigint,
  expected: readonly HrLeaveStateTag[],
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === leaveId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one leave request, found ${matches.length}`)
  const row = matches[0]
  if (!row
    || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId
    || parseStrictU64(row.companyId ?? row.company_id) !== companyId
    || !(expected as readonly string[]).includes(hrLeaveStateTag(row.state))) return null
  return { resource: "leave-requests", id: leaveId.toString() }
}
