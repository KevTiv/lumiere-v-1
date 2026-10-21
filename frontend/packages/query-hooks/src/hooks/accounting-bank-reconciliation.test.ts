import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveBankStatementReconciliationEffect,
  resolveBankStatementSettlementEffect,
  type BankReconciliationLineProjection,
  type BankReconciliationStatementProjection,
} from "./accounting/bank-statements"
import { AmbiguousOperationEffectError } from "./operation-effect"

const line: BankReconciliationLineProjection = {
  id: "41",
  organizationId: 7n,
  statementId: "31",
  isReconciled: true,
  moveIds: [91n, "92"],
  amountResidual: 0,
}
const statement: BankReconciliationStatementProjection = {
  id: 31n,
  organizationId: "7",
  companyId: "8",
  state: { tag: "Open" },
}
const args = {
  organizationId: 7n,
  companyId: 8n,
  lineId: 41n,
  moveIds: [92n, 91n],
  amountResidual: 0,
}

describe("resolveBankStatementReconciliationEffect", () => {
  it("returns the exact company-scoped line and stable move-line set", () => {
    assert.deepEqual(resolveBankStatementReconciliationEffect([line], [statement], args), {
      resource: "bank-statement-lines",
      id: "41",
      statementId: "31",
      companyId: "8",
      moveLineIds: ["91", "92"],
      isReconciled: true,
    })
  })

  it("fails closed for wrong scope, closed statement, or effect set", () => {
    assert.equal(resolveBankStatementReconciliationEffect([line], [{ ...statement, companyId: 9n }], args), null)
    assert.equal(resolveBankStatementReconciliationEffect([line], [{ ...statement, state: "Posted" }], args), null)
    assert.equal(resolveBankStatementReconciliationEffect([{ ...line, moveIds: [91n] }], [statement], args), null)
  })

  it("rejects duplicate exact records as ambiguous", () => {
    assert.throws(
      () => resolveBankStatementReconciliationEffect([line, { ...line }], [statement], args),
      AmbiguousOperationEffectError,
    )
  })

  it("does not confirm a missing or redacted residual as zero", () => {
    for (const amountResidual of [null, undefined, "", " ", false]) {
      assert.equal(resolveBankStatementReconciliationEffect([{ ...line, amountResidual }], [statement], args), null)
    }
  })
})

function settlementFixture() {
  const scoped = { organizationId: 7n, companyId: 8n, currencyId: 3n, partnerId: 4n }
  const line = { id: 41n, organizationId: 7n, statementId: 31n, journalId: 5n, amount: 100,
    paymentIds: [50n], moveIds: [91n], isReconciled: true, amountResidual: 0 }
  const statement = { id: 31n, organizationId: 7n, companyId: 8n, journalId: 5n, currencyId: 3n, state: "Open" }
  const payment = { id: 50n, ...scoped, journalId: 5n, amount: 100, paymentType: "InBound", partnerType: "Customer", state: "Paid", moveId: 60n }
  const invoice = { id: 70n, ...scoped, journalId: 6n, state: "Posted", moveType: "OutInvoice", paymentState: "Paid", amountResidual: 0 }
  const paymentMove = { id: 60n, ...scoped, journalId: 5n, state: "Posted", moveType: "Entry" }
  const target = { id: 91n, ...scoped, moveId: 70n, parentState: "Posted", accountInternalType: "receivable", amountResidual: 0, matchingNumber: "MATCH-60-70" }
  const clearing = { id: 92n, ...scoped, moveId: 60n, accountInternalType: "receivable", amountResidual: 0 }
  return { line, statement, financial: { payments: [payment], moves: [invoice, paymentMove], moveLines: [target, clearing] },
    args: { organizationId: 7n, companyId: 8n, lineId: 41n, moveIds: [91n], amountResidual: 0 } }
}

describe("bank settlement financial effect proof", () => {
  it("requires a posted payment, settled invoice and zero clearing residual", () => {
    const f = settlementFixture()
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], f.financial, f.args)?.status, "confirmed")
    for (const patch of [{ amountResidual: undefined }, { amountResidual: null }, { amountResidual: 100 }, { matchingNumber: "MATCH-FOREIGN" }]) {
      assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, moveLines: [{ ...f.financial.moveLines[0], ...patch }, f.financial.moveLines[1]!] }, f.args), null)
    }
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, moveLines: [f.financial.moveLines[0]!] }, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, payments: [{ ...f.financial.payments[0]!, state: "Reversed" }] }, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([{ ...f.line, paymentIds: [] }], [f.statement], f.financial, f.args), null)
  })
  it("distinguishes a draft approval request and approved payment from matched settlement", () => {
    const f = settlementFixture()
    const line = { ...f.line, isReconciled: false, moveIds: [], amountResidual: 100 }
    const financial = { payments: [{ ...f.financial.payments[0]!, state: "NotPaid", moveId: undefined }],
      moves: [{ ...f.financial.moves[0]!, paymentState: "NotPaid", amountResidual: 100 }],
      moveLines: [{ ...f.financial.moveLines[0]!, amountResidual: 100, matchingNumber: undefined }] }
    assert.deepEqual(resolveBankStatementSettlementEffect([line], [f.statement], financial, f.args), {
      status: "awaiting_approval", paymentId: "50", resource: "account-payments", id: "50",
    })
    assert.equal(resolveBankStatementSettlementEffect([line], [f.statement], { ...financial, payments: f.financial.payments, moves: [...financial.moves, f.financial.moves[1]!] }, f.args)?.status, "awaiting_approval")
    assert.equal(resolveBankStatementSettlementEffect([line], [f.statement], { ...financial, payments: [{ ...financial.payments[0]!, amount: 99 }] }, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([line], [f.statement], { ...financial, moveLines: [{ ...financial.moveLines[0]!, amountResidual: 99 }] }, f.args), null)
  })
  it("fails closed for duplicate, cross-company and unavailable financial evidence", () => {
    const f = settlementFixture()
    assert.equal(resolveBankStatementSettlementEffect([f.line, f.line], [f.statement], f.financial, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, payments: [...f.financial.payments, ...f.financial.payments] }, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, moves: f.financial.moves.map((move) => ({ ...move, companyId: 9n })) }, f.args), null)
    assert.equal(resolveBankStatementSettlementEffect([f.line], [f.statement], { ...f.financial, payments: f.financial.payments.map((payment) => ({ ...payment, partnerType: undefined })) }, f.args), null)
  })
})
