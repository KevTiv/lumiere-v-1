import assert from "node:assert/strict"
import test from "node:test"

import {
  awardRfqBidAction,
  isPurchaseLineReceivable,
  isPurchaseOrderBillable,
  isPurchaseOrderCancellable,
  isPurchaseOrderConfirmable,
  isPurchaseOrderSendable,
  isRequisitionApprovable,
  isRequisitionClosable,
  isRequisitionConvertible,
  isRequisitionSubmittable,
  observeAwardedRfq,
  observeConfirmedPurchaseOrder,
  observeConvertedRequisition,
  observeCreatedBill,
  observeReceivedLine,
  observeSentPurchaseOrder,
  poSourceRfqId,
  purchaseLineOpenQty,
  receivePurchaseLineAction,
} from "./procure-to-pay"

test("requisition actions follow Draft → InProgress → Approved, including enum-shaped state", () => {
  assert.ok(isRequisitionSubmittable({ state: "Draft" }))
  assert.ok(!isRequisitionSubmittable({ state: "InProgress" }))
  assert.ok(isRequisitionApprovable({ state: { tag: "InProgress" } }))
  assert.ok(!isRequisitionApprovable({ state: "Draft" }))
  assert.ok(isRequisitionConvertible({ state: "Approved" }))
  assert.ok(!isRequisitionConvertible({ state: "Closed" }))
})

test("close and cancel stay available until a requisition is terminal", () => {
  assert.ok(isRequisitionClosable({ state: "Sent" }))
  assert.ok(isRequisitionClosable({ state: "Approved" }))
  assert.ok(!isRequisitionClosable({ state: "Closed" }))
  assert.ok(!isRequisitionClosable({ state: { tag: "Cancelled" } }))
})

test("purchase order send/confirm/cancel gates mirror the reducers", () => {
  assert.ok(isPurchaseOrderSendable({ state: "Draft" }))
  assert.ok(!isPurchaseOrderSendable({ state: "Sent" }))
  for (const state of ["Draft", "Sent", "ToApprove"]) assert.ok(isPurchaseOrderConfirmable({ state }), state)
  assert.ok(!isPurchaseOrderConfirmable({ state: "Purchase" }))
  assert.ok(isPurchaseOrderCancellable({ state: "Purchase" }))
  assert.ok(!isPurchaseOrderCancellable({ state: "Done" }))
  assert.ok(!isPurchaseOrderCancellable({ state: { tag: "Cancelled" } }))
})

test("a bill is offered only for a confirmed order that is not fully invoiced", () => {
  assert.ok(isPurchaseOrderBillable({ state: "Purchase", invoiceStatus: { tag: "Partial" } }))
  assert.ok(isPurchaseOrderBillable({ state: "Done", invoice_status: "No" }))
  assert.ok(!isPurchaseOrderBillable({ state: "Purchase", invoiceStatus: "Invoiced" }))
  assert.ok(!isPurchaseOrderBillable({ state: "Sent", invoiceStatus: "No" }))
})

test("an order left in Draft by the send approval gate is approval_pending", () => {
  assert.equal(observeSentPurchaseOrder("5", [{ id: 5, state: "Draft" }]).outcome, "approval_pending")
  assert.deepEqual(observeSentPurchaseOrder("5", [{ id: 5, state: "Sent" }]), { outcome: "applied" })
  assert.deepEqual(observeSentPurchaseOrder("9", [{ id: 5, state: "Sent" }]), {})
})

test("a confirmed order links its receipt pickings and stays the next record", () => {
  const observed = observeConfirmedPurchaseOrder("5", [{ id: 5, state: { tag: "Purchase" }, pickingIds: [11, 12] }])
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords, [
    { resource: "stock_picking", id: "11", module: "inventory", context: "purchasing" },
    { resource: "stock_picking", id: "12", module: "inventory", context: "purchasing" },
  ])
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "5", module: "purchasing" })
})

test("an order left unconfirmed by the approval gate is approval_pending", () => {
  const observed = observeConfirmedPurchaseOrder("5", [{ id: 5, state: "Sent" }])
  assert.equal(observed.outcome, "approval_pending")
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "5", module: "purchasing" })
})

test("a converted requisition opens the newest PO it produced", () => {
  const observed = observeConvertedRequisition("3", [{ id: 3, purchaseIds: [7, 9] }])
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "9", module: "purchasing" })
  assert.deepEqual(observed.createdRecords, [observed.next])
  assert.deepEqual(observeConvertedRequisition("3", [{ id: 3, purchase_ids: [] }]), {})
})

test("the PO an RFQ award created is found by its rfq_id stamp, newest first", () => {
  assert.equal(poSourceRfqId({ metadata: '{"rfq_id":4,"awarded_bid_id":2}' }), "4")
  assert.equal(poSourceRfqId({ metadata: "not json" }), undefined)
  assert.equal(poSourceRfqId({}), undefined)
  const observed = observeAwardedRfq("4", [
    { id: 10, metadata: '{"rfq_id":4}' },
    { id: 12, metadata: '{"rfq_id":4}' },
    { id: 13, metadata: '{"rfq_id":5}' },
    { id: 14, metadata: null },
  ])
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "12", module: "purchasing" })
  assert.deepEqual(observeAwardedRfq("99", []), {})
})

test("the vendor bill is the last entry of the order's invoice ids and opens in accounting", () => {
  const observed = observeCreatedBill("5", [{ id: 5, invoiceIds: [20, 21] }])
  const bill = { resource: "account_move", id: "21", module: "accounting", context: "purchasing" }
  assert.deepEqual(observed.createdRecords, [bill])
  assert.deepEqual(observed.next, bill)
  assert.deepEqual(observeCreatedBill("5", [{ id: 5, invoiceIds: [] }]), {})
})

test("receiving needs open quantity and defaults the row dispatch to all of it", () => {
  assert.equal(purchaseLineOpenQty({ productQty: 10, qtyReceived: 4 }), 6)
  assert.equal(purchaseLineOpenQty({ product_qty: 5, qty_received: 9 }), 0)
  assert.ok(isPurchaseLineReceivable({ productQty: 10, qtyReceived: 4 }))
  assert.ok(!isPurchaseLineReceivable({ productQty: 10, qtyReceived: 10 }))
  const action = receivePurchaseLineAction({ label: "Receive", execute: async () => ({ outcome: "applied", affectedResources: [] }) })
  assert.deepEqual(action.prepare?.({ id: 8, productQty: 10, qtyReceived: 4 }), { lineId: "8", qty: 6 })
})

test("the receipt just validated is the newest done move's picking for that line", () => {
  const observed = observeReceivedLine("8", [
    { purchaseLineId: 8, isDone: true, pickingId: 30 },
    { purchaseLineId: 8, isDone: true, pickingId: 33 },
    { purchaseLineId: 8, isDone: false, pickingId: 34 },
    { purchaseLineId: 9, isDone: true, pickingId: 40 },
  ])
  assert.deepEqual(observed.next, { resource: "stock_picking", id: "33", module: "inventory", context: "purchasing" })
  // A service line has no move, so the user stays where they are.
  assert.deepEqual(observeReceivedLine("8", []), { outcome: "applied" })
})

test("an RFQ award prepares the bid's rfq and id and only offers submitted bids", () => {
  const action = awardRfqBidAction({ label: "Award", execute: async () => ({ outcome: "applied", affectedResources: [] }) })
  assert.ok(action.canPresent({ id: 2, state: "submitted" }))
  assert.ok(!action.canPresent({ id: 2, state: "awarded" }))
  assert.deepEqual(action.prepare?.({ id: 2, rfqId: 4, state: "submitted" }), { rfqId: "4", bidId: "2" })
})
