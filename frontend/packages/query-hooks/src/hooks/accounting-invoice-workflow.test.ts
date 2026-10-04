import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveReconciliationEffect,
  resolveRegisteredPaymentEffect,
} from "./accounting/invoice-workflow"
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

describe("resolveRegisteredPaymentEffect", () => {
  const input = { paymentId: 81n, invoiceIds: [91n, 92n], isBill: false }
  const payment = { id: "81", companyId: "5", state: { tag: "Paid" } }
  const paidInvoice = {
    id: 91n,
    companyId: 5n,
    moveType: "OutInvoice",
    state: "Posted",
    paymentState: { tag: "Paid" },
    amountResidual: 0,
  }
  const partialRefund = {
    id: "92",
    company_id: "5",
    move_type: "out_refund",
    state: { tag: "Posted" },
    payment_state: "Partial",
    amount_residual: 25,
  }

  it("returns the exact payment when every exact customer document is settled", () => {
    const result = resolveRegisteredPaymentEffect(
      [payment],
      [paidInvoice, partialRefund],
      input,
    )
    assert.equal(result?.outcome, "applied")
    assert.deepEqual(result?.next, {
      resource: "account_payment",
      id: "81",
      module: "accounting",
    })
  })

  it("accepts exact vendor bill and refund effects", () => {
    const result = resolveRegisteredPaymentEffect(
      [payment],
      [
        { ...paidInvoice, id: 93n, moveType: "InInvoice" },
        { ...partialRefund, id: 94n, move_type: "InRefund" },
      ],
      { paymentId: 81n, invoiceIds: [93n, 94n], isBill: true },
    )
    assert.equal(result?.next?.id, "81")
  })

  it("fails closed when an exact payment or document is missing", () => {
    assert.equal(resolveRegisteredPaymentEffect([], [paidInvoice, partialRefund], input), null)
    assert.equal(resolveRegisteredPaymentEffect([payment], [paidInvoice], input), null)
    assert.equal(
      resolveRegisteredPaymentEffect([payment], [paidInvoice, partialRefund], {
        ...input,
        invoiceIds: [],
      }),
      null,
    )
  })

  it("fails closed for the wrong company, document kind, state, or residual", () => {
    assert.equal(
      resolveRegisteredPaymentEffect(
        [payment],
        [{ ...paidInvoice, companyId: 6n }, partialRefund],
        input,
      ),
      null,
    )
    assert.equal(
      resolveRegisteredPaymentEffect(
        [payment],
        [{ ...paidInvoice, moveType: "InInvoice" }, partialRefund],
        input,
      ),
      null,
    )
    assert.equal(
      resolveRegisteredPaymentEffect(
        [payment],
        [{ ...paidInvoice, paymentState: "NotPaid" }, partialRefund],
        input,
      ),
      null,
    )
    assert.equal(
      resolveRegisteredPaymentEffect(
        [payment],
        [{ ...paidInvoice, amountResidual: 1 }, partialRefund],
        input,
      ),
      null,
    )
  })

  it("rejects duplicate exact payment or document ids as ambiguous", () => {
    assert.throws(
      () => resolveRegisteredPaymentEffect([payment, { ...payment }], [paidInvoice, partialRefund], input),
      AmbiguousOperationEffectError,
    )
    assert.throws(
      () =>
        resolveRegisteredPaymentEffect(
          [payment],
          [paidInvoice, { ...paidInvoice }, partialRefund],
          input,
        ),
      AmbiguousOperationEffectError,
    )
  })
})
