import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveReconciliationEffect } from "./accounting/invoice-workflow"
import { AmbiguousOperationEffectError } from "./operation-effect"

const input = { paymentMoveId: 71n, invoiceMoveId: 72n }
const payment = {
  id: "71",
  companyId: "5",
  state: { tag: "Posted" },
  paymentState: "Partial",
  amountResidual: 0,
}
const invoice = {
  id: 72n,
  companyId: 5n,
  state: "Posted",
  paymentState: { tag: "Paid" },
  amountResidual: 0,
}

describe("resolveReconciliationEffect", () => {
  it("returns the exact reconciled invoice", () => {
    const result = resolveReconciliationEffect([payment, invoice], input)
    assert.equal(result?.outcome, "applied")
    assert.equal(result?.next.id, "72")
  })

  it("accepts a canonical partial reconciliation", () => {
    const result = resolveReconciliationEffect(
      [payment, { ...invoice, paymentState: "Partial", amountResidual: 25 }],
      input,
    )
    assert.equal(result?.next.id, "72")
  })

  it("fails closed for wrong company, state, or residual", () => {
    assert.equal(resolveReconciliationEffect([payment, { ...invoice, companyId: 6n }], input), null)
    assert.equal(resolveReconciliationEffect([{ ...payment, state: "Draft" }, invoice], input), null)
    assert.equal(resolveReconciliationEffect([payment, { ...invoice, amountResidual: -1 }], input), null)
  })

  it("rejects duplicate exact ids as ambiguous", () => {
    assert.throws(
      () => resolveReconciliationEffect([payment, { ...payment }, invoice], input),
      AmbiguousOperationEffectError,
    )
  })
})
