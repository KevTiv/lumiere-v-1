import assert from "node:assert/strict"
import test from "node:test"

import type { RowValueMap } from "@lumiere/erp-shared/row-values"
import { summarizeOrderToCash, withOrderCashSummary } from "./order-summary"

const sale = { id: 5, state: { tag: "Sale" } }
const line = (ordered: number, delivered: number, extra = {}) => ({
  orderId: 5,
  productUomQty: ordered,
  qtyDelivered: delivered,
  ...extra,
})
const invoice = (state: string, total: number, residual: number, moveType = "OutInvoice") => ({
  saleOrderId: 5,
  moveType: { tag: moveType },
  state: { tag: state },
  amountTotal: total,
  amountResidual: residual,
})
test("delivery follows delivered vs ordered stock quantity and ignores services", () => {
  const d = (lines: RowValueMap[]) => summarizeOrderToCash(sale, { lines, moves: [] }).delivery
  assert.equal(d([line(10, 0)]), "pending")
  assert.equal(d([line(10, 6)]), "partial")
  assert.equal(d([line(10, 10)]), "complete")
  assert.equal(d([line(10, 10), line(1, 0, { isService: true })]), "complete")
  assert.equal(d([line(1, 0, { isService: true })]), "none")
  assert.equal(summarizeOrderToCash({ id: 5, state: "Draft" }, { lines: [line(10, 0)], moves: [] }).delivery, "none")
})

test("a partial delivery with a delivery still open is partial; with none left it is short", () => {
  const d = (pickings: RowValueMap[] | undefined, lines = [line(10, 6)]) =>
    summarizeOrderToCash(sale, { lines, moves: [], pickings }).delivery
  const done = { id: 1, saleId: 5, state: "done" }
  assert.equal(d([done, { id: 2, saleId: 5, state: "confirmed" }]), "partial")
  assert.equal(d([done, { id: 2, saleId: 5, state: "assigned" }]), "partial")
  assert.equal(d([done, { id: 2, saleId: 5, state: "cancel" }]), "short")
  assert.equal(d([done]), "short")
})

test("without the order's pickings a partial delivery stays partial", () => {
  assert.equal(summarizeOrderToCash(sale, { lines: [line(10, 6)], moves: [] }).delivery, "partial")
})

test("a return picking does not count as a delivery still to come", () => {
  const pickings = [
    { id: 1, saleId: 5, state: "done" },
    { id: 3, saleId: 5, state: "assigned", isReturn: true },
  ]
  assert.equal(summarizeOrderToCash(sale, { lines: [line(10, 6)], moves: [], pickings }).delivery, "short")
})

test("complete and pending do not depend on pickings", () => {
  const cancelled = [{ id: 1, saleId: 5, state: "cancel" }]
  assert.equal(summarizeOrderToCash(sale, { lines: [line(10, 10)], moves: [], pickings: cancelled }).delivery, "complete")
  assert.equal(summarizeOrderToCash(sale, { lines: [line(10, 0)], moves: [], pickings: cancelled }).delivery, "pending")
})

test("withOrderCashSummary attributes each picking to its own order", () => {
  const rows = withOrderCashSummary(
    [sale, { id: 6, state: "Sale" }],
    [line(10, 6), { orderId: 6, productUomQty: 10, qtyDelivered: 6 }],
    [],
    [
      { id: 1, saleId: 5, state: "done" },
      { id: 2, saleId: 5, state: "cancel" },
      { id: 3, saleId: 6, state: "done" },
      { id: 4, saleId: 6, state: "confirmed" },
    ],
  )
  assert.deepEqual(rows.map((r) => r.deliverySummary), ["short", "partial"])
})

test("nothing invoiced yet has no invoice, payment or balance", () => {
  const s = summarizeOrderToCash(sale, { lines: [], moves: [] })
  assert.deepEqual([s.invoice, s.payment, s.outstanding], ["none", "none", 0])
})

test("a draft invoice is not yet receivable", () => {
  const s = summarizeOrderToCash(sale, { lines: [], moves: [invoice("Draft", 100, 100)] })
  assert.deepEqual([s.invoice, s.payment, s.outstanding], ["draft", "none", 0])
})

test("a posted invoice moves through unpaid, partial and paid from its residual", () => {
  const s = (residual: number) => summarizeOrderToCash(sale, { lines: [], moves: [invoice("Posted", 100, residual)] })
  assert.deepEqual([s(100).invoice, s(100).payment, s(100).outstanding], ["posted", "unpaid", 100])
  assert.deepEqual([s(40).payment, s(40).outstanding], ["partial", 40])
  assert.deepEqual([s(0).payment, s(0).outstanding], ["paid", 0])
})

test("cancelled documents are ignored and a full posted credit note marks the invoice credited", () => {
  const cancelled = summarizeOrderToCash(sale, { lines: [], moves: [invoice("Cancel", 100, 100)] })
  assert.equal(cancelled.invoice, "none")
  const credited = summarizeOrderToCash(sale, {
    lines: [],
    moves: [invoice("Posted", 100, 0), invoice("Posted", 100, 0, "OutRefund")],
  })
  assert.equal(credited.invoice, "credited")
  const partialCredit = summarizeOrderToCash(sale, {
    lines: [],
    moves: [invoice("Posted", 100, 0), invoice("Posted", 30, 0, "OutRefund")],
  })
  assert.equal(partialCredit.invoice, "posted")
})

test("vendor bills and other orders' documents never leak into an order", () => {
  const rows = withOrderCashSummary(
    [sale, { id: 6, state: "Sale" }],
    [line(4, 4), { orderId: 6, productUomQty: 4, qtyDelivered: 0 }],
    [invoice("Posted", 50, 50, "InInvoice"), { ...invoice("Posted", 80, 0), saleOrderId: 6 }],
  )
  assert.deepEqual(
    [rows[0]!.deliverySummary, rows[0]!.invoiceSummary, rows[0]!.outstandingAmount],
    ["complete", "none", 0],
  )
  assert.deepEqual(
    [rows[1]!.deliverySummary, rows[1]!.invoiceSummary, rows[1]!.paymentSummary],
    ["pending", "posted", "paid"],
  )
})

test("an order walks from confirmed to paid with the balance following the money", () => {
  const delivered = [line(10, 10)]
  const step = (moves: RowValueMap[], lines = delivered) => summarizeOrderToCash(sale, { lines, moves })
  const view = (moves: RowValueMap[], lines = delivered) => {
    const s = step(moves, lines)
    return [s.delivery, s.invoice, s.payment, s.outstanding]
  }

  assert.deepEqual(view([], [line(10, 0)]), ["pending", "none", "none", 0])
  assert.deepEqual(view([], delivered), ["complete", "none", "none", 0])
  assert.deepEqual(view([invoice("Draft", 500, 500)]), ["complete", "draft", "none", 0])
  assert.deepEqual(view([invoice("Posted", 500, 500)]), ["complete", "posted", "unpaid", 500])
  assert.deepEqual(view([invoice("Posted", 500, 200)]), ["complete", "posted", "partial", 200])
  assert.deepEqual(view([invoice("Posted", 500, 0)]), ["complete", "posted", "paid", 0])
})

test("an overpaid invoice reads paid with no negative balance", () => {
  const s = summarizeOrderToCash(sale, { lines: [], moves: [invoice("Posted", 100, -20)] })
  assert.deepEqual([s.payment, s.outstanding], ["paid", 0])
})

test("an order billed per delivery owes the sum of what is still unpaid across its invoices", () => {
  const s = summarizeOrderToCash(sale, {
    lines: [line(10, 10)],
    moves: [invoice("Posted", 400, 0), invoice("Posted", 600, 600)],
  })
  assert.deepEqual([s.invoice, s.payment, s.outstanding], ["posted", "partial", 600])
})

test("a second invoice still in draft does not hide the posted one", () => {
  const s = summarizeOrderToCash(sale, {
    lines: [line(10, 4)],
    moves: [invoice("Posted", 400, 400), invoice("Draft", 600, 600)],
  })
  assert.deepEqual([s.invoice, s.payment, s.outstanding], ["posted", "unpaid", 400])
})

test("a partial credit note leaves the invoice open, and only a full one marks it credited", () => {
  const posted = invoice("Posted", 100, 100)
  const partial = summarizeOrderToCash(sale, { lines: [], moves: [posted, invoice("Posted", 30, 0, "OutRefund")] })
  assert.equal(partial.invoice, "posted")
  const full = summarizeOrderToCash(sale, { lines: [], moves: [posted, invoice("Posted", 100, 0, "OutRefund")] })
  assert.equal(full.invoice, "credited")
})

test("a cancelled invoice that was replaced by a new draft reads as a draft, not as billed", () => {
  const s = summarizeOrderToCash(sale, {
    lines: [],
    moves: [invoice("Cancel", 100, 100), invoice("Draft", 100, 100)],
  })
  assert.deepEqual([s.invoice, s.payment, s.outstanding], ["draft", "none", 0])
})

test("supplier bills on the same order never count as what the customer owes", () => {
  const s = summarizeOrderToCash(sale, {
    lines: [],
    moves: [invoice("Posted", 100, 100), invoice("Posted", 900, 900, "InInvoice")],
  })
  assert.deepEqual([s.invoice, s.outstanding], ["posted", 100])
})
