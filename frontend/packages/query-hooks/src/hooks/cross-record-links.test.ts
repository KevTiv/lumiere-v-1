import assert from "node:assert/strict"
import test from "node:test"
import { proposalOrderLinks, purchaseOrderLinks } from "./cross-record-links"

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

test("omitted projected relation fields are unavailable, not evidence of no downstream records", () => {
  assert.equal(proposalOrderLinks(row("10"), scope, []).status, "unavailable")
  assert.deepEqual(proposalOrderLinks(row("10", { saleOrderId: null }), scope, []), { status: "ready", links: [] })
})
