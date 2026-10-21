import assert from "node:assert/strict"
import test from "node:test"

import { WorkflowError } from "../core/errors"
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
  requisitionPurchaseIds,
  observeCreatedBill,
  observeReceivedLine,
  observeSentPurchaseOrder,
  poSourceRfqId,
  purchaseLineOpenQty,
  purchaseOrderInvoiceIds,
  receivePurchaseLineAction,
  resolveOpenReceiptTarget,
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

test("a converted requisition opens the one PO added since the snapshot, never the last entry", () => {
  const before = requisitionPurchaseIds("3", [{ id: 3, purchaseIds: [7] }])
  assert.deepEqual(before, ["7"])
  const observed = observeConvertedRequisition("3", before!, [{ id: 3, purchaseIds: [9, 7] }])
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "9", module: "purchasing" })
  assert.deepEqual(observed.createdRecords, [observed.next])
  assert.equal(requisitionPurchaseIds("3", []), undefined)
  assert.deepEqual(observeConvertedRequisition("3", ["7"], [{ id: 3, purchase_ids: [7] }]), {})
  assert.deepEqual(observeConvertedRequisition("3", ["7"], [{ id: 3, purchase_ids: [7, 9, 11] }]), {})
  assert.deepEqual(observeConvertedRequisition("3", [], []), {})
})

test("an RFQ award is confirmed by the RFQ's own purchase_order_id, not the newest stamped PO", () => {
  assert.equal(poSourceRfqId({ origin: "rfq:4" }), "4")
  assert.equal(poSourceRfqId({ metadata: '{"rfq_id":4,"awarded_bid_id":2}' }), "4")
  assert.equal(poSourceRfqId({ origin: "rfq:4", metadata: '{"rfq_id":4}' }), "4")
  assert.equal(poSourceRfqId({ origin: "rfq:4", metadata: '{"rfq_id":5}' }), undefined)
  assert.equal(poSourceRfqId({ origin: "rfq:4:latest" }), undefined)
  assert.equal(poSourceRfqId({ metadata: "not json" }), undefined)
  assert.equal(poSourceRfqId({}), undefined)
  const orders = [
    { id: 10, origin: "rfq:4" },
    { id: 12, metadata: '{"rfq_id":4}' },
    { id: 13, metadata: '{"rfq_id":5}' },
  ]
  const observed = observeAwardedRfq("4", [{ id: 4, state: "awarded", purchaseOrderId: 10 }], orders)
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.next, { resource: "purchase_order", id: "10", module: "purchasing" })
  assert.deepEqual(observed.createdRecords, [observed.next])
  assert.deepEqual(observeAwardedRfq("4", [{ id: 4, state: "open", purchaseOrderId: null }], orders), {})
  assert.deepEqual(observeAwardedRfq("4", [{ id: 4, state: "awarded", purchase_order_id: null }], orders), {})
  assert.deepEqual(observeAwardedRfq("4", [{ id: 4, state: "awarded", purchaseOrderId: 13 }], orders), {})
  assert.deepEqual(observeAwardedRfq("4", [{ id: 4, state: "awarded", purchaseOrderId: 99 }], orders), {})
  assert.deepEqual(observeAwardedRfq("99", [], []), {})
})

test("vendor bill identity is the one exact new id in the PO relation", () => {
  const before = purchaseOrderInvoiceIds("5", [{ id: 5, invoiceIds: [20] }])
  assert.deepEqual(before, ["20"])

  const observed = observeCreatedBill("5", before ?? [], [
    { id: 5, invoiceIds: [20, 21] },
  ])
  const bill = {
    resource: "account_move",
    id: "21",
    module: "accounting",
    context: "purchasing",
  }
  assert.deepEqual(observed.createdRecords, [bill])
  assert.deepEqual(observed.next, bill)

  // No new effect, multiple concurrent effects, or relation regression is unresolved.
  assert.deepEqual(observeCreatedBill("5", ["20"], [{ id: 5, invoiceIds: [20] }]), {})
  assert.deepEqual(
    observeCreatedBill("5", ["20"], [{ id: 5, invoiceIds: [20, 21, 22] }]),
    {},
  )
  assert.deepEqual(observeCreatedBill("5", ["20"], [{ id: 5, invoiceIds: [21] }]), {})
})

test("receiving needs open quantity and defaults the row dispatch to all of it", () => {
  assert.equal(purchaseLineOpenQty({ productQty: 10, qtyReceived: 4 }), 6)
  assert.equal(purchaseLineOpenQty({ product_qty: 5, qty_received: 9 }), 0)
  assert.ok(isPurchaseLineReceivable({ productQty: 10, qtyReceived: 4 }))
  assert.ok(!isPurchaseLineReceivable({ productQty: 10, qtyReceived: 10 }))
  const action = receivePurchaseLineAction({ label: "Receive", execute: async () => ({ outcome: "applied", affectedResources: [] }) })
  assert.deepEqual(action.prepare?.({ id: 8, productQty: 10, qtyReceived: 4 }), { lineId: "8", qty: 6 })
})

test("receipt correlation captures one open move before dispatch and never chooses newest", () => {
  const before = [
    { id: 100, purchaseLineId: 8, state: "draft", isDone: false, pickingId: 30 },
    { id: 101, purchaseLineId: 9, state: "draft", isDone: false, pickingId: 40 },
  ]
  const target = resolveOpenReceiptTarget("8", before)
  assert.deepEqual(target, { moveId: "100", pickingId: "30" })

  const after = [
    { id: 100, purchaseLineId: 8, state: "done", isDone: true, pickingId: 30 },
    // A higher id done move for the same line must not steal the result identity.
    { id: 109, purchaseLineId: 8, state: "done", isDone: true, pickingId: 33 },
  ]
  const observed = observeReceivedLine("8", target, after)
  assert.deepEqual(observed.next, {
    resource: "stock_picking",
    id: "30",
    module: "inventory",
    context: "purchasing",
  })

  // Ambiguous open relations fail closed, not reduced to first/latest or zero.
  assert.throws(
    () => resolveOpenReceiptTarget("8", [
      { id: 100, purchaseLineId: 8, state: "draft", isDone: false, pickingId: 30 },
      { id: 102, purchaseLineId: 8, state: "assigned", isDone: false, pickingId: 31 },
    ]),
    (error: unknown) => error instanceof WorkflowError && error.kind === "conflict",
  )

  // No move is not proof of a service line or an applied receipt.
  assert.equal(resolveOpenReceiptTarget("8", []), undefined)
  assert.deepEqual(observeReceivedLine("8", undefined, []), {})
  assert.deepEqual(observeReceivedLine("8", undefined, after), {})
})

test("receipt resolution excludes wrong lines and terminal moves and supports snake-case identities", () => {
  const terminal = [
    { id: 100, purchaseLineId: 8, state: "done", isDone: true, pickingId: 30 },
    { id: 101, purchaseLineId: 8, state: "done", isDone: true, pickingId: 30 },
    { id: 102, purchaseLineId: 8, state: "cancel", isDone: false, pickingId: 30 },
    { id: 103, purchaseLineId: 9, state: "draft", pickingId: null },
  ]
  assert.equal(resolveOpenReceiptTarget("8", terminal), undefined)
  assert.deepEqual(resolveOpenReceiptTarget("8", [
    ...terminal,
    { id: 104n, purchase_line_id: 8n, state: "assigned", is_done: false, picking_id: 31n },
  ]), { moveId: "104", pickingId: "31" })
})

test("matched open receipt moves with missing or malformed identities throw typed conflicts", () => {
  for (const pickingId of [undefined, null, "", " ", 0, -1, 1.5, NaN, Infinity, {}, [], true, "invalid"]) {
    for (const moves of [
      [{ id: 100, purchaseLineId: 8, state: "draft", isDone: false, pickingId }],
      [
        { id: 99, purchaseLineId: 8, state: "draft", isDone: false, pickingId: 29 },
        { id: 100, purchaseLineId: 8, state: "draft", isDone: false, pickingId },
      ],
    ]) {
      assert.throws(
        () => resolveOpenReceiptTarget("8", moves),
        (error: unknown) => error instanceof WorkflowError && error.kind === "conflict",
      )
    }
  }
  for (const id of [undefined, null, "", {}, 0]) {
    assert.throws(
      () => resolveOpenReceiptTarget("8", [{ id, purchaseLineId: 8, state: "draft", isDone: false, pickingId: 30 }]),
      (error: unknown) => error instanceof WorkflowError && error.kind === "conflict",
    )
  }
})

test("receipt readback requires the captured move, exact line and picking, and done proof", () => {
  const target = { moveId: "100", pickingId: "30" }
  for (const moves of [
    [],
    [{ id: 109, purchaseLineId: 8, pickingId: 30, state: "done" }],
    [{ id: 100, purchaseLineId: 9, pickingId: 30, state: "done" }],
    [{ id: 100, purchaseLineId: 8, pickingId: 31, state: "done" }],
    [{ id: 100, purchaseLineId: 8, pickingId: null, state: "done" }],
    [{ id: 100, purchaseLineId: 8, pickingId: 30, state: "assigned", isDone: false }],
    [{ id: 100, purchaseLineId: 8, pickingId: 30, state: "cancel", isDone: false }],
  ]) {
    assert.deepEqual(observeReceivedLine("8", target, moves), {})
  }
  for (const proof of [{ state: "done", isDone: true }, { state: "done", is_done: true }]) {
    const observed = observeReceivedLine("8", target, [
      { id: 100, purchase_line_id: 8, picking_id: 30, ...proof },
    ])
    assert.equal(observed.outcome, "applied")
    assert.deepEqual(observed.createdRecords, [observed.next])
    assert.equal(observed.next?.id, "30")
  }
})

test("matching receipt done evidence must be boolean and consistent before and after dispatch", () => {
  const target = { moveId: "100", pickingId: "30" }
  for (const proof of [
    { state: "assigned" }, { state: "done" },
    ...[null, "false", "true", 0, 1].map((isDone) => ({ state: "done", isDone })),
    { state: "assigned", isDone: true }, { state: "done", isDone: false },
  ]) {
    const move = { id: 100, purchaseLineId: 8, pickingId: 30, ...proof }
    assert.throws(() => resolveOpenReceiptTarget("8", [move]),
      (error: unknown) => error instanceof WorkflowError && error.kind === "conflict")
    assert.deepEqual(observeReceivedLine("8", target, [move]), {})
  }
})

test("an RFQ award prepares the bid's rfq and id and only offers submitted bids", () => {
  const action = awardRfqBidAction({ label: "Award", execute: async () => ({ outcome: "applied", affectedResources: [] }) })
  assert.ok(action.canPresent({ id: 2, state: "submitted" }))
  assert.ok(!action.canPresent({ id: 2, state: "awarded" }))
  assert.deepEqual(action.prepare?.({ id: 2, rfqId: 4, state: "submitted" }), { rfqId: "4", bidId: "2" })
})
