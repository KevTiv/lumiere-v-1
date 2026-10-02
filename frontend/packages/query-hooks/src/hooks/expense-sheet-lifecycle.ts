import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type ExpenseSheetStateTag = "Draft" | "Submitted" | "Approved" | "Posted" | "Done" | "Refused"

export type ExpenseSheetEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly accountMoveId?: unknown
  readonly account_move_id?: unknown
  readonly reimbursementMoveId?: unknown
  readonly reimbursement_move_id?: unknown
}

export type ExpenseSheetEffectExpectation = {
  readonly states: readonly ExpenseSheetStateTag[]
  /** The sheet must carry a posting move (post and reimburse). */
  readonly requirePostingMove?: boolean
  /**
   * The sheet must carry a reimbursement move that differs from `previous`
   * (the value read before dispatch, `null` when there was none), so an
   * earlier partial reimbursement never proves a later one.
   */
  readonly reimbursementMoveChangedFrom?: bigint | null
}

/** Normalise a SATS enum cell (`"Posted"`, `{ tag: "Posted" }`, `{ posted: [] }`). */
export function expenseSheetStateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    if ("tag" in state && typeof state.tag === "string") return state.tag
    const keys = Object.keys(state)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

/** `Option<u64>` cell (`n`, `{ some: n }`, `{ none: [] }`, null) as a bigint or `null`. */
function optionalU64(value: unknown): bigint | null {
  return parseStrictU64(value) ?? null
}

/** The sheet's current reimbursement move id, or `null`, for the exact id/scope. */
export function expenseSheetReimbursementMoveId(
  rows: readonly ExpenseSheetEffectProjection[],
  organizationId: bigint,
  sheetId: bigint,
): bigint | null {
  const row = exactSheetRow(rows, sheetId)
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  return optionalU64(row.reimbursementMoveId ?? row.reimbursement_move_id)
}

function exactSheetRow(rows: readonly ExpenseSheetEffectProjection[], sheetId: bigint) {
  const matches = rows.filter((row) => parseStrictU64(row.id) === sheetId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one expense sheet, found ${matches.length}`)
  }
  return matches[0]
}

/**
 * COV-11: resolve the same expense sheet id, in the same organization (and
 * company when known), in an expected state. Post and reimburse resolve through
 * the sheet's own `account_move_id` / `reimbursement_move_id` relations, never a
 * newest-move lookup.
 */
export function resolveExpenseSheetEffect(
  rows: readonly ExpenseSheetEffectProjection[],
  organizationId: bigint,
  companyId: bigint | null | undefined,
  sheetId: bigint,
  expected: ExpenseSheetEffectExpectation,
): CanonicalRecordRef | null {
  const row = exactSheetRow(rows, sheetId)
  if (!row) return null
  if (parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  if (companyId != null && parseStrictU64(row.companyId ?? row.company_id) !== companyId) return null
  if (!(expected.states as readonly string[]).includes(expenseSheetStateTag(row.state))) return null
  const postingMove = optionalU64(row.accountMoveId ?? row.account_move_id)
  if (expected.requirePostingMove && postingMove == null) return null
  if (expected.reimbursementMoveChangedFrom !== undefined) {
    const reimbursementMove = optionalU64(row.reimbursementMoveId ?? row.reimbursement_move_id)
    if (reimbursementMove == null || reimbursementMove === expected.reimbursementMoveChangedFrom) return null
    if (reimbursementMove === postingMove) return null
  }
  return { resource: "expense-sheets", id: sheetId.toString() }
}
