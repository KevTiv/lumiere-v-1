import assert from "node:assert/strict"
import { test } from "node:test"
import { purchaseDiscrepancies, purchaseDiscrepancyHandoffs, scopedPurchaseReviewRows } from "./purchase-discrepancies"

const scope = { organizationId: 1n, companyId: 2n }
const order = { ...scope, id: "9007199254740993", state: "Purchase", name: "PO Exact", receiptStatus: "partial", invoiceIds: ["21"] }
const line = { ...scope, id: "9007199254740995", orderId: order.id, name: "Materials", state: "Draft", productQty: 10, qtyReceived: 5, qtyInvoiced: 8 }

test("discrepancy queues open the exact current order/line without numeric coercion or inferred relationships", () => {
  const result = purchaseDiscrepancies([order], [line], [order], [line], scope)
  assert.equal(result.unresolved, 0)
  assert.equal(result.partial[0].linesHref, "/purchasing/orders/9007199254740993?tab=lines")
  assert.equal(result.overBilled[0].lineHref, "/purchasing?tab=lines&filter=id%3A9007199254740995")
  assert.equal(result.overBilled[0].handoffsHref, "/purchasing/orders/9007199254740993?tab=handoffs")
  assert.deepEqual([result.overBilled[0].ordered, result.overBilled[0].received, result.overBilled[0].billed], [10, 5, 8])
})

test("stale queue, missing/duplicate parent, malformed quantities and foreign context never select first or latest", () => {
  for (const orders of [[], [order, order], [{ ...order, companyId: 3n }], [{ ...order, state: "Cancelled" }]]) {
    const result = purchaseDiscrepancies([order], [line], orders, [line], scope)
    assert.equal(result.partial.length, 0)
    assert.equal(result.overBilled.length, 0)
    assert.ok(result.unresolved > 0)
  }
  for (const current of [{ ...line, qtyInvoiced: 5 }, { ...line, productQty: NaN }, { ...line, qtyReceived: "" },
    { ...line, orderId: "6" }, { ...line, companyId: 3n }]) {
    assert.equal(purchaseDiscrepancies([], [line], [order], [current], scope).overBilled.length, 0)
  }
  assert.equal(purchaseDiscrepancies([], [line], [order], [line, line], scope).overBilled.length, 0)
  assert.deepEqual(purchaseDiscrepancies([{ ...order, companyId: 3n }], [{ ...line, organizationId: 3n }], [order], [line], scope), { partial: [], overBilled: [], unresolved: 0 })
  assert.deepEqual(scopedPurchaseReviewRows([order, { ...order, companyId: 3n }, { ...order, id: 9007199254740992 }], scope), [order])
})

test("order handoffs verify receipt kind, exact bill IDs/type and scope, with unknown relations kept unavailable", () => {
  const picking = { ...scope, id: "31", purchaseId: order.id, pickingCode: "incoming", state: "Done" }
  const bill = { ...scope, id: "21", moveType: "InInvoice", state: "Draft" }
  const result = purchaseDiscrepancyHandoffs(order, scope, [picking, { ...picking, id: "32", companyId: 3n }], [bill, { ...bill, id: "22", invoiceOrigin: order.name }])
  assert.equal(result.status, "ready")
  assert.deepEqual(result.links.map((link) => [link.kind, link.id]), [["receipt", "31"], ["bill", "21"]])
  assert.equal(purchaseDiscrepancyHandoffs(order, scope, [], [{ ...bill, moveType: "OutInvoice" }]).status, "unavailable")
  assert.equal(purchaseDiscrepancyHandoffs({ ...order, invoiceIds: undefined }, scope, [picking], [bill]).status, "unavailable")
  assert.equal(purchaseDiscrepancyHandoffs(order, scope, [{ ...picking, pickingCode: undefined }], [bill]).status, "unavailable")
  const { pickingCode: _masked, ...masked } = picking
  assert.equal(purchaseDiscrepancyHandoffs(order, scope, [masked], [bill]).status, "unavailable")
  assert.equal(purchaseDiscrepancyHandoffs(order, scope, [], [{ ...bill, companyId: 3n }]).status, "unavailable")
})
