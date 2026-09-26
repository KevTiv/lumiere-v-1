import assert from "node:assert/strict"
import test from "node:test"

import {
  isInvoiceLikeMoveType,
  isInvoicePostable,
  isPaymentPostable,
  isPaymentRegistrable,
} from "./invoice-to-payment"

test("only draft invoices and refunds post through post_invoice", () => {
  assert.ok(isInvoicePostable({ moveType: "OutInvoice", state: "Draft" }))
  assert.ok(isInvoicePostable({ moveType: { tag: "InRefund" }, state: { tag: "Draft" } }))
  assert.ok(isInvoicePostable({ move_type: "out_invoice", state: "draft" }))
  assert.ok(!isInvoicePostable({ moveType: "OutInvoice", state: "Posted" }))
  assert.ok(!isInvoicePostable({ moveType: "Entry", state: "Draft" }))
  assert.ok(!isInvoicePostable({ state: "Draft" }))
})

test("invoice-like move types cover customer and vendor documents", () => {
  for (const type of ["OutInvoice", "InInvoice", "OutRefund", "InRefund", { tag: "OutInvoice" }, "in_refund"]) {
    assert.ok(isInvoiceLikeMoveType(type), JSON.stringify(type))
  }
  for (const type of ["Entry", "InternalTransfer", undefined]) {
    assert.ok(!isInvoiceLikeMoveType(type), String(type))
  }
})

test("a payment posts from NotPaid and is applied to invoices only once posted", () => {
  assert.ok(isPaymentPostable({ state: "NotPaid" }))
  assert.ok(!isPaymentPostable({ state: "Paid" }))
  assert.ok(isPaymentRegistrable({ state: { tag: "Paid" } }))
  assert.ok(!isPaymentRegistrable({ state: "NotPaid" }))
})
