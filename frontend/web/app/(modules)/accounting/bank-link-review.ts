import {
  projectReconciliation,
  reconciliationId,
  reconciliationSelection,
  type ReconciliationRequest,
  type ReconciliationSource,
  type ReconciliationBankLineSource,
} from "../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"
import type {
  BankReconciliationLineProjection,
  BankReconciliationStatementProjection,
} from "@lumiere/query-hooks/hooks/accounting/bank-statements"

/** Preserve decoded Option::None as known-empty, never invent redacted fields. */
export function bankLineFromQueryRow(row: ReconciliationBankLineSource): ReconciliationBankLineSource {
  const line = { ...row }
  for (const key of ["currencyId", "foreignCurrencyId"] as const) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] === undefined) line[key] = null
  }
  return line
}

/** Recheck the current source immediately before dispatching a reviewed link. */
export function canDispatchReviewedBankLink(source: ReconciliationSource, request: ReconciliationRequest, allowed: boolean): boolean {
  if (!allowed || request.amountResidual !== 0) return false
  const current = projectReconciliation(source)
  if (current.status !== "ready") return false
  const reviewed = reconciliationSelection(current, request.moveLineIds).request
  return reviewed !== null && reviewed.organizationId === request.organizationId
    && reviewed.companyId === request.companyId && reviewed.statementId === request.statementId
    && reviewed.lineId === request.lineId
}

/** Exact, read-only effect check. Missing/redacted residuals never stand in for zero. */
export function bankLinkReadbackConfirms(request: ReconciliationRequest, lines: readonly BankReconciliationLineProjection[], statements: readonly BankReconciliationStatementProjection[]): boolean {
  const matches = lines.filter((row) => reconciliationId(row.id) === request.lineId)
  const parents = statements.filter((row) => reconciliationId(row.id) === request.statementId)
  if (matches.length !== 1 || parents.length !== 1) return false
  const line = matches[0]!
  const statement = parents[0]!
  const state = typeof statement.state === "string" ? statement.state
    : statement.state && typeof statement.state === "object" && "tag" in statement.state ? statement.state.tag : null
  const residual = line.amountResidual ?? line.amount_residual
  const ids = line.moveIds ?? line.move_ids
  if (reconciliationId(line.organizationId ?? line.organization_id) !== request.organizationId
    || reconciliationId(line.statementId ?? line.statement_id) !== request.statementId
    || reconciliationId(statement.organizationId ?? statement.organization_id) !== request.organizationId
    || reconciliationId(statement.companyId ?? statement.company_id) !== request.companyId
    || state !== "Open" || (line.isReconciled ?? line.is_reconciled) !== true
    || residual === null || residual === undefined || (typeof residual === "string" && residual.trim() === "")
    || (typeof residual !== "number" && typeof residual !== "string") || Number(residual) !== 0
    || !Array.isArray(ids) || ids.length !== request.moveLineIds.length) return false
  const exact = ids.map(reconciliationId)
  return exact.every((id) => id !== null) && new Set(exact).size === exact.length
    && new Set(request.moveLineIds).size === request.moveLineIds.length
    && request.moveLineIds.length > 0 && request.moveLineIds.every((id) => exact.includes(id))
}
