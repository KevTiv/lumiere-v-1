import assert from "node:assert/strict"
import test from "node:test"
import { proposalOrderLinks, purchaseOrderLinks, subscriptionRecordLinks } from "./cross-record-links"

const scope = { organizationId: 1n, companyId: 2n }
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, organizationId: "1", companyId: "2", ...extra,
})

test("PO zero/one/many receipts and bills preserve every exact ID, excluding foreign scope/returns", () => {
  assert.deepEqual(purchaseOrderLinks(row("10", { invoiceIds: [] }), scope, [], []), { status: "ready", links: [] })
  const parent = row("10", { invoiceIds: ["20", "21"] })
  const result = purchaseOrderLinks(parent, scope, [
    row("30", { purchaseId: { some: "10" } }), row("31", { purchase_id: "10" }),
    row("32", { purchaseId: "10", isReturn: true }),
    row("33", { purchaseId: "10", state: { tag: "Cancelled" } }),
    row("34", { purchaseId: "11" }), row("35", { purchaseId: "10", companyId: "3" }),
  ], [row("20"), row("21")])
  assert.equal(result.status, "ready")
  assert.deepEqual(result.links.map((link) => [link.kind, link.id]), [["receipt", "30"], ["receipt", "31"], ["bill", "20"], ["bill", "21"]])
  assert.equal(purchaseOrderLinks(parent, scope, [], [row("20")]).status, "unavailable")
})

test("PO duplicate relation/target is an invariant failure, never first/latest", () => {
  assert.equal(purchaseOrderLinks(row("10", { invoiceIds: ["20", "20"] }), scope, [], [row("20")]).status, "invariant_failure")
  assert.equal(purchaseOrderLinks(row("10", { invoiceIds: ["20"] }), scope, [], [row("20"), row("20")]).status, "invariant_failure")
  assert.equal(purchaseOrderLinks(row("10", { invoiceIds: [] }), scope, [row("30", { purchaseId: "10" }), row("30", { purchaseId: "10" })], []).status, "invariant_failure")
  assert.equal(purchaseOrderLinks(row("10"), scope, [], []).status, "unavailable")
})

test("proposal 0..1 relation handles absent, exact large ID, unavailable scope and duplicate targets", () => {
  assert.deepEqual(proposalOrderLinks(row("10", { saleOrderId: { none: [] } }), scope, []), { status: "ready", links: [] })
  const id = "9007199254740993"
  const parent = row("10", { saleOrderId: { some: id } })
  assert.equal(proposalOrderLinks(parent, scope, [row(id)]).links[0]?.href, `/sales?tab=orders&filter=id%3A${id}`)
  assert.equal(proposalOrderLinks(parent, scope, []).status, "unavailable")
  assert.equal(proposalOrderLinks(parent, scope, [row(id, { organizationId: "3" })]).status, "unavailable")
  assert.equal(proposalOrderLinks(parent, scope, [row(id), row(id)]).status, "invariant_failure")
  assert.equal(proposalOrderLinks(row("10", { saleOrderId: "invalid" }), scope, []).status, "invariant_failure")
})

test("subscription uses billing-run FK and exact reconciled invoice IDs; 0..N is a list, not ambiguity", () => {
  const parent = row("10")
  assert.deepEqual(subscriptionRecordLinks(parent, scope, [], [], []), { status: "ready", links: [] })
  const runs = [row("1", { subscriptionId: "10", invoiceMoveId: "20" }), row("2", { subscriptionId: "10", invoiceMoveId: "21" }), row("3", { subscriptionId: "11", invoiceMoveId: "22" })]
  const result = subscriptionRecordLinks(parent, scope, runs, [row("20"), row("21"), row("22")], [
    row("30", { reconciledInvoiceIds: ["20", "21"] }), row("31", { reconciled_invoice_ids: ["21"] }),
    row("32", { reconciledInvoiceIds: ["22"] }), row("33", { reconciledInvoiceIds: ["20"], companyId: "3" }),
    row("34", { ref: "SUB10-PAY-20", partnerId: "1", reconciledInvoiceIds: [] }),
  ])
  assert.equal(result.status, "ready")
  assert.deepEqual(result.links.map((link) => [link.kind, link.id]), [["invoice", "20"], ["invoice", "21"], ["payment", "30"], ["payment", "31"]])
  assert.equal(result.links[2]?.href, "/accounting?tab=payments&filter=id%3A30")
})

test("subscription missing/duplicate exact effects fail closed", () => {
  const run = row("1", { subscriptionId: "10", invoiceMoveId: "20" })
  assert.equal(subscriptionRecordLinks(row("10"), scope, [run], [], []).status, "unavailable")
  assert.equal(subscriptionRecordLinks(row("10"), scope, [run, { ...run, id: "2" }], [row("20")], []).status, "invariant_failure")
  const ambiguousPayment = subscriptionRecordLinks(row("10"), scope, [run], [row("20")], [row("30", { reconciledInvoiceIds: ["20"] }), row("30", { reconciledInvoiceIds: ["20"] })])
  assert.equal(ambiguousPayment.status, "ready")
  if (ambiguousPayment.status === "ready") assert.equal(ambiguousPayment.paymentNotice?.status, "invariant_failure")
  assert.deepEqual(ambiguousPayment.links.map((link) => link.kind), ["invoice"])
})

test("unavailable or omitted payment relation preserves independent exact invoices with explicit notice", () => {
  const run = row("1", { subscriptionId: "10", invoiceMoveId: "20" })
  for (const payments of [undefined, [row("30")], [row("30", { reconciledInvoiceIds: "malformed" })]]) {
    const result = subscriptionRecordLinks(row("10"), scope, [run], [row("20")], payments)
    assert.equal(result.status, "ready")
    assert.deepEqual(result.links.map((link) => [link.kind, link.id]), [["invoice", "20"]])
    if (result.status === "ready") assert.equal(result.paymentNotice?.status, "unavailable")
  }
})

test("omitted projected relation fields are unavailable, not evidence of no downstream records", () => {
  assert.equal(proposalOrderLinks(row("10"), scope, []).status, "unavailable")
  assert.deepEqual(proposalOrderLinks(row("10", { saleOrderId: null }), scope, []), { status: "ready", links: [] })
  const run = row("1", { subscriptionId: "10", invoiceMoveId: "20" })
  for (const relation of [undefined, "invalid", ["bad-id"]]) {
    const result = subscriptionRecordLinks(row("10"), scope, [run], [row("20")],
      [row("30", { reconciledInvoiceIds: relation })])
    assert.equal(result.status, "ready")
    if (result.status === "ready") assert.equal(result.paymentNotice?.status, "unavailable")
    assert.deepEqual(result.links.map(link => link.kind), ["invoice"])
  }
})

test("duplicate payment reconciliation references fail closed", () => {
  const run = row("1", { subscriptionId: "10", invoiceMoveId: "20" })
  const result = subscriptionRecordLinks(row("10"), scope, [run], [row("20")],
    [row("30", { reconciledInvoiceIds: ["20", "20"] })])
  assert.equal(result.status, "ready")
  if (result.status === "ready") assert.equal(result.paymentNotice?.status, "invariant_failure")
  assert.deepEqual(result.links.map(link => link.kind), ["invoice"])
})
