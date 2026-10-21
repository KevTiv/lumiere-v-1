import assert from "node:assert/strict"
import test from "node:test"
import { bankLineFromQueryRow, bankLinkReadbackConfirms, bankSettlementRecoveryPermissions, canDispatchReviewedBankLink } from "./bank-link-review"
import { decodeTypedResourceQueryResponse } from "@lumiere/stdb/resource-reads"
import type { ReconciliationRequest, ReconciliationSource } from "../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"

const request: ReconciliationRequest = { organizationId: "7", companyId: "11", statementId: "30", lineId: "31", moveLineIds: ["9007199254740992", "9007199254740993"], amountResidual: 0 }
const statement = { id: "30", organizationId: "7", companyId: "11", state: "Open" }
const line = { id: "31", organizationId: "7", statementId: "30", isReconciled: true, amountResidual: 0, moveIds: [...request.moveLineIds] }

test("resubmission requires cancelling the original draft even when creating its replacement is allowed", () => {
  const grants = new Set(["account_bank_statement_line:write"])
  const checkPermission = (resource: string, action: string) => ({ allowed: grants.has(`${resource}:${action}`) })
  assert.deepEqual(bankSettlementRecoveryPermissions(true, true, checkPermission), { abandon: false, resubmit: false, reverse: false })
  grants.add("payment:cancel")
  assert.deepEqual(bankSettlementRecoveryPermissions(true, true, checkPermission), { abandon: true, resubmit: true, reverse: false })
  assert.equal(bankSettlementRecoveryPermissions(true, false, checkPermission).resubmit, false)
  assert.deepEqual(bankSettlementRecoveryPermissions(false, true, checkPermission), { abandon: false, resubmit: false, reverse: false })
})

test("coordinated reversal requires the statement, journal and payment permissions independently of cancellation", () => {
  const required = ["account_bank_statement_line:write", "payment:reverse", "account_move:write", "account_bank_statement:write"]
  const grants = new Set(required)
  const checkPermission = (resource: string, action: string) => ({ allowed: grants.has(`${resource}:${action}`) })
  assert.deepEqual(bankSettlementRecoveryPermissions(true, false, checkPermission), { abandon: false, resubmit: false, reverse: true })
  for (const permission of required) {
    grants.delete(permission)
    assert.equal(bankSettlementRecoveryPermissions(true, false, checkPermission).reverse, false, permission)
    grants.add(permission)
  }
})

test("bank currency options retain known-empty values through the real typed decoder, not redaction", () => {
  const decoded = decodeTypedResourceQueryResponse("bank-statement-lines", {
    data: [{ id: "31", organizationId: "7", currencyId: null, foreignCurrencyId: null }],
  })[0]!
  assert.equal(Object.hasOwn(decoded, "foreignCurrencyId"), true)
  assert.equal(decoded.foreignCurrencyId, undefined)
  assert.equal(bankLineFromQueryRow(decoded).foreignCurrencyId, null)
  assert.equal(bankLineFromQueryRow(decoded).currencyId, null)
  const redacted = decodeTypedResourceQueryResponse("bank-statement-lines", { data: [{ id: "31", organizationId: "7" }] })[0]!
  assert.equal(Object.hasOwn(bankLineFromQueryRow(redacted), "foreignCurrencyId"), false)
  assert.equal(Object.hasOwn(bankLineFromQueryRow(redacted), "currencyId"), false)
  assert.equal(bankLineFromQueryRow({ currencyId: 7n, foreignCurrencyId: 8n }).foreignCurrencyId, 8n)
})

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
