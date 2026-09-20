import assert from "node:assert/strict"
import test from "node:test"

import {
  isSaleOrderConfirmable,
  isSaleOrderInvoiceable,
  observeConfirmedOrder,
  observeCreatedInvoice,
} from "./order-to-cash"

test("only draft and sent orders offer confirm, including enum-shaped state", () => {
  assert.ok(isSaleOrderConfirmable({ state: "Draft" }))
  assert.ok(isSaleOrderConfirmable({ state: { tag: "Sent" } }))
  assert.ok(!isSaleOrderConfirmable({ state: "Sale" }))
  assert.ok(!isSaleOrderConfirmable({ state: { tag: "Cancel" } }))
})

test("a confirmed order links its delivery pickings and opens the first", () => {
  const observed = observeConfirmedOrder(
    "5",
    [{ id: 5, state: { tag: "Sale" } }],
    [
      { id: 11, saleId: 5, isReturn: false },
      { id: 12, saleId: 6, isReturn: false },
      { id: 13, saleId: 5, isReturn: true },
    ],
  )
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords, [{ resource: "stock_picking", id: "11", module: "inventory", context: "sales" }])
  assert.deepEqual(observed.next, { resource: "stock_picking", id: "11", module: "inventory", context: "sales" })
})

test("an order left unconfirmed by the approval gate is approval_pending and stays the next record", () => {
  const observed = observeConfirmedOrder("5", [{ id: 5, state: "Draft" }], [])
  assert.equal(observed.outcome, "approval_pending")
  assert.deepEqual(observed.next, { resource: "sale_order", id: "5", module: "sales" })
})

test("a confirmed order without stock-tracked deliveries falls back to the order", () => {
  const observed = observeConfirmedOrder("5", [{ id: 5, state: "Sale" }], [])
  assert.equal(observed.createdRecords, undefined)
  assert.equal(observed.next?.resource, "sale_order")
})

test("an order missing from the readback yields no claims", () => {
  assert.deepEqual(observeConfirmedOrder("5", [], []), {})
})

test("a confirmed order offers invoicing until it is fully invoiced", () => {
  assert.ok(isSaleOrderInvoiceable({ state: "Sale", invoiceStatus: "ToInvoice" }))
  assert.ok(isSaleOrderInvoiceable({ state: { tag: "Done" }, invoiceStatus: { tag: "NoInvoice" } }))
  assert.ok(isSaleOrderInvoiceable({ state: "Sale" }))
  assert.ok(!isSaleOrderInvoiceable({ state: "Sale", invoiceStatus: { tag: "Invoiced" } }))
  assert.ok(!isSaleOrderInvoiceable({ state: "Draft", invoiceStatus: "ToInvoice" }))
})

test("the newest invoice on the order is created and opened in Accounting", () => {
  const observed = observeCreatedInvoice("5", [{ id: 5, invoiceIds: [40n, 41n] }, { id: 6, invoiceIds: [99n] }])
  const ref = { resource: "account_move", id: "41", module: "accounting", context: "sales" }
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords, [ref])
  assert.deepEqual(observed.next, ref)
})

test("an order without a readback invoice yields no claims", () => {
  assert.deepEqual(observeCreatedInvoice("5", [{ id: 5, invoiceIds: [] }]), {})
  assert.deepEqual(observeCreatedInvoice("5", []), {})
})
