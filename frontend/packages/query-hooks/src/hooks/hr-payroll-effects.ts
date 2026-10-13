import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from "./operation-effect"

export type HrPayslipEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly accountMoveId?: unknown
  readonly account_move_id?: unknown
}

export function hrPayslipStateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    if ("tag" in state && typeof state.tag === "string") return state.tag
    const keys = Object.keys(state)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

function exactPayslip(
  rows: readonly HrPayslipEffectProjection[],
  organizationId: bigint,
  companyId: bigint,
  payslipId: bigint,
): HrPayslipEffectProjection | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === payslipId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one payslip, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (
    !row ||
    parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
    parseStrictU64(row.companyId ?? row.company_id) !== companyId
  ) {
    return null
  }
  return row
}

/** Resolve an exact, scoped payslip state transition without relying on list order. */
export function resolvePayslipStateEffect(
  rows: readonly HrPayslipEffectProjection[],
  organizationId: bigint,
  companyId: bigint,
  payslipId: bigint,
  expectedState: "Verify" | "Cancelled",
): CanonicalRecordRef | null {
  const row = exactPayslip(rows, organizationId, companyId, payslipId)
  if (!row || hrPayslipStateTag(row.state) !== expectedState) return null
  return { resource: "payslips", id: payslipId.toString() }
}

/**
 * Resolve payroll posting only when the exact payslip is Done and points at an
 * exact scoped account move. This is the canonical employee-to-GL handoff.
 */
export function resolvePayslipPostingEffect(
  payslips: readonly HrPayslipEffectProjection[],
  accountMoves: readonly HrPayslipEffectProjection[],
  organizationId: bigint,
  companyId: bigint,
  payslipId: bigint,
): CanonicalRecordRef | null {
  const payslip = exactPayslip(payslips, organizationId, companyId, payslipId)
  if (!payslip || hrPayslipStateTag(payslip.state) !== "Done") return null
  const moveId = parseStrictU64(payslip.accountMoveId ?? payslip.account_move_id)
  if (moveId == null) return null

  const matches = accountMoves.filter((move) => parseStrictU64(move.id) === moveId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one payroll account move, found ${matches.length}`,
    )
  }
  const move = matches[0]
  if (
    !move ||
    parseStrictU64(move.organizationId ?? move.organization_id) !== organizationId ||
    parseStrictU64(move.companyId ?? move.company_id) !== companyId
  ) {
    return null
  }
  return { resource: "account-moves", id: moveId.toString() }
}
