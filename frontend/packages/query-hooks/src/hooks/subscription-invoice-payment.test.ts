import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  invoiceResidualBefore,
  paymentStateTag,
  resolveInvoicePaymentEffect,
  type InvoicePaymentProjection,
} from "./subscription-invoice-payment"

const move = (extra: Partial<InvoicePaymentProjection> = {}): InvoicePaymentProjection => ({
  id: 40n,
  organizationId: 1n,
  companyId: 3n,
  paymentState: { tag: "Paid" },
  amountResidual: 0,
  ...extra,
})

test("normalises payment states", () => {
  assert.equal(paymentStateTag("Partial"), "Partial")
  assert.equal(paymentStateTag({ tag: "NotPaid" }), "NotPaid")
  assert.equal(paymentStateTag({ paid: [] }), "Paid")
  assert.equal(paymentStateTag(undefined), "")
})

test("reads the residual before dispatch for the exact invoice and scope", () => {
  assert.equal(invoiceResidualBefore([move({ amountResidual: 100 })], 1n, 3n, 40n), 100)
  assert.equal(invoiceResidualBefore([move({ amountResidual: undefined, amount_residual: "55.5" })], 1n, 3n, 40n), 55.5)
  assert.equal(invoiceResidualBefore([move()], 2n, 3n, 40n), null)
  assert.equal(invoiceResidualBefore([move()], 1n, 4n, 40n), null)
  assert.equal(invoiceResidualBefore([move({ id: 41n })], 1n, 3n, 40n), null)
  assert.equal(invoiceResidualBefore([move({ amountResidual: undefined })], 1n, 3n, 40n), null)
})

test("a full payment is the invoice paid with a lower residual", () => {
  assert.deepEqual(resolveInvoicePaymentEffect([move()], 1n, 3n, 40n, 100), { resource: "account-moves", id: "40" })
})

test("a partial payment lowers the residual and reads Partial", () => {
  const partial = move({ paymentState: "Partial", amountResidual: 40 })
  assert.deepEqual(resolveInvoicePaymentEffect([partial], 1n, 3n, 40n, 100), { resource: "account-moves", id: "40" })
})

test("an unchanged residual, a held payment or another state is no effect", () => {
  assert.equal(resolveInvoicePaymentEffect([move({ paymentState: "NotPaid", amountResidual: 100 })], 1n, 3n, 40n, 100), null)
  assert.equal(resolveInvoicePaymentEffect([move({ amountResidual: 100 })], 1n, 3n, 40n, 100), null)
  assert.equal(resolveInvoicePaymentEffect([move({ paymentState: "NotPaid", amountResidual: 40 })], 1n, 3n, 40n, 100), null)
  assert.equal(resolveInvoicePaymentEffect([move({ paymentState: "Reversed", amountResidual: 40 })], 1n, 3n, 40n, 100), null)
})

test("a residual that was already zero can not be paid again", () => {
  assert.equal(resolveInvoicePaymentEffect([move()], 1n, 3n, 40n, 0), null)
})

test("returns null for another scope and throws on duplicate ids", () => {
  assert.equal(resolveInvoicePaymentEffect([move({ organizationId: 2n })], 1n, 3n, 40n, 100), null)
  assert.equal(resolveInvoicePaymentEffect([move({ companyId: 4n })], 1n, 3n, 40n, 100), null)
  assert.throws(() => resolveInvoicePaymentEffect([move(), move()], 1n, 3n, 40n, 100), AmbiguousOperationEffectError)
})
