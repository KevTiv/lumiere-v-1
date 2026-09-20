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
