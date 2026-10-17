import assert from "node:assert/strict"
import test from "node:test"
import { bankLinkReadbackConfirms, canDispatchReviewedBankLink } from "./bank-link-review"
import type { ReconciliationRequest, ReconciliationSource } from "../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"

const request: ReconciliationRequest = { organizationId: "7", companyId: "11", statementId: "30", lineId: "31", moveLineIds: ["9007199254740992", "9007199254740993"], amountResidual: 0 }
const statement = { id: "30", organizationId: "7", companyId: "11", state: "Open" }
const line = { id: "31", organizationId: "7", statementId: "30", isReconciled: true, amountResidual: 0, moveIds: [...request.moveLineIds] }

test("bank-link readback confirms exact scope and adjacent large identifiers without rounding", () => {
  assert.equal(bankLinkReadbackConfirms(request, [line], [statement]), true)
  assert.equal(bankLinkReadbackConfirms(request, [{ ...line, moveIds: [...line.moveIds].reverse() }], [statement]), true)
})
test("bank-link readback rejects missing, redacted and nonzero residuals", () => {
  for (const value of [undefined, null, "", " ", false, 0.01, NaN]) {
    assert.equal(bankLinkReadbackConfirms(request, [{ ...line, amountResidual: value }], [statement]), false)
  }
})
test("bank-link readback rejects false or unavailable matching status", () => {
  for (const value of [undefined, null, false, "true"]) {
    assert.equal(bankLinkReadbackConfirms(request, [{ ...line, isReconciled: value }], [statement]), false)
  }
})
test("bank-link readback rejects another company, organization or statement", () => {
  assert.equal(bankLinkReadbackConfirms(request, [line], [{ ...statement, companyId: "12" }]), false)
  assert.equal(bankLinkReadbackConfirms(request, [{ ...line, organizationId: "8" }], [statement]), false)
  assert.equal(bankLinkReadbackConfirms(request, [{ ...line, statementId: "32" }], [statement]), false)
})
test("bank-link readback rejects missing, duplicate and inexact link records", () => {
  assert.equal(bankLinkReadbackConfirms(request, [], [statement]), false)
  assert.equal(bankLinkReadbackConfirms(request, [line, line], [statement]), false)
  assert.equal(bankLinkReadbackConfirms(request, [line], [statement, statement]), false)
  assert.equal(bankLinkReadbackConfirms(request, [{ ...line, moveIds: [request.moveLineIds[0], request.moveLineIds[0]] }], [statement]), false)
  assert.equal(bankLinkReadbackConfirms(request, [{ ...line, moveIds: [request.moveLineIds[0]] }], [statement]), false)
})
test("bank-link readback supports canonical snake fields but never a different lifecycle", () => {
  assert.equal(bankLinkReadbackConfirms(request, [{ id: "31", organization_id: "7", statement_id: "30", is_reconciled: true, amount_residual: 0, move_ids: line.moveIds }], [{ ...statement, state: { tag: "Open" } }]), true)
  assert.equal(bankLinkReadbackConfirms(request, [line], [{ ...statement, state: "Posted" }]), false)
})
test("dispatch guard blocks non-ready sources and revoked write access", () => {
  const source: ReconciliationSource = { organizationId: 7n, companyId: 11n, companyCurrencyId: 5n, state: { status: "denied" }, statement: null, line: null, bankLines: [], moves: [], moveLines: [], accounts: [], currencies: [] }
  assert.equal(canDispatchReviewedBankLink(source, request, true), false)
  assert.equal(canDispatchReviewedBankLink({ ...source, state: { status: "ready" } }, request, false), false)
})
