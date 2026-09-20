import assert from "node:assert/strict"
import test from "node:test"

import {
  ACCEPT_SALE_ORDER_QUOTATION_AFFECTS,
  isSaleOrderEditable,
  isSaleOrderLockable,
  isSaleOrderTotalsComputable,
  isSaleOrderUnlockable,
  CANCEL_SALE_ORDER_AFFECTS,
  cancelSaleOrderAction,
  isSaleOrderAcceptable,
  isSaleOrderCancellable,
  isSaleOrderConfirmable,
  isSaleOrderSendable,
  sendSaleOrderQuotationAction,
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

test("only a draft quotation can be sent and only a sent one accepted", () => {
  assert.ok(isSaleOrderSendable({ state: "Draft" }))
  assert.ok(isSaleOrderSendable({ state: { tag: "Draft" } }))
  assert.ok(!isSaleOrderSendable({ state: "Sent" }))
  assert.ok(isSaleOrderAcceptable({ state: { tag: "Sent" } }))
  assert.ok(!isSaleOrderAcceptable({ state: "Draft" }))
  assert.ok(!isSaleOrderAcceptable({ state: "Sale" }))
})

test("cancel is offered until an order is done or cancelled, whichever spelling the state has", () => {
  for (const state of ["Draft", "Sent", "Sale", "ToApprove"]) assert.ok(isSaleOrderCancellable({ state }), state)
  for (const state of ["Done", "Cancelled", "Cancel"]) assert.ok(!isSaleOrderCancellable({ state }), state)
  assert.ok(!isSaleOrderCancellable({ state: { tag: "Cancelled" } }))
})

test("cancel declares the deliveries, reservations and commissions it releases", () => {
  for (const resource of ["stock-pickings", "stock-moves", "stock-quants", "sale-commissions"]) {
    assert.ok((CANCEL_SALE_ORDER_AFFECTS as readonly string[]).includes(resource), resource)
  }
  assert.deepEqual([...ACCEPT_SALE_ORDER_QUOTATION_AFFECTS], ["sale-orders"])
})

test("send and cancel are record actions dispatched with the order id; cancel is destructive", async () => {
  const seen: string[] = []
  const execute = async (id: string) => {
    seen.push(id)
    return { outcome: "applied" as const, affectedResources: [] }
  }
  const send = sendSaleOrderQuotationAction({ label: "Send", execute })
  const cancel = cancelSaleOrderAction({ label: "Cancel", execute })
  assert.equal(send.kind, "immediate")
  assert.equal(cancel.kind, "destructive")
  await send.execute(send.prepare!({ id: 7, state: "Draft" }))
  await cancel.execute(cancel.prepare!({ id: 8, state: "Sale" }))
  assert.deepEqual(seen, ["7", "8"])
})

test("lock and unlock are mutually exclusive on the order's lock flag, in either field spelling", () => {
  assert.ok(isSaleOrderLockable({ state: "Sale", isLocked: false }))
  assert.ok(isSaleOrderLockable({ state: "Draft" }))
  assert.ok(!isSaleOrderLockable({ state: "Sale", is_locked: true }))
  assert.ok(isSaleOrderUnlockable({ state: "Sale", isLocked: true }))
  assert.ok(!isSaleOrderUnlockable({ state: "Sale", isLocked: false }))
  assert.ok(!isSaleOrderUnlockable({ state: "Sale" }))
})

test("finished and cancelled orders cannot be locked, and cancelled ones cannot recompute totals", () => {
  for (const state of ["Done", "Cancelled", "Cancel"]) assert.ok(!isSaleOrderLockable({ state }), state)
  assert.ok(isSaleOrderTotalsComputable({ state: "Sale" }))
  assert.ok(isSaleOrderTotalsComputable({ state: "Done" }))
  assert.ok(!isSaleOrderTotalsComputable({ state: { tag: "Cancelled" } }))
  assert.ok(!isSaleOrderTotalsComputable({ state: "Cancel" }))
})

test("only an unlocked draft or sent order can have its header edited", () => {
  assert.ok(isSaleOrderEditable({ state: "Draft", isLocked: false }))
  assert.ok(isSaleOrderEditable({ state: { tag: "Sent" } }))
  assert.ok(!isSaleOrderEditable({ state: "Draft", isLocked: true }))
  assert.ok(!isSaleOrderEditable({ state: "Sale" }))
})
