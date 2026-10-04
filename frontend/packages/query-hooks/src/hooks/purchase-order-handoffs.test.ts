import assert from "node:assert/strict"
import test from "node:test"
import { purchaseOrderHandoffs } from "./purchase-order-handoffs"

const scope = { organizationId: 1n, companyId: 3n }
const order = { id: 5n, ...scope, invoiceIds: [21n, 22n, 23n, 24n, 25n] }
const receipt = (id: bigint, extra = {}) => ({ id, ...scope, purchaseId: 5n, pickingCode: "incoming", state: "done", ...extra })
const bill = (id: bigint, extra = {}) => ({ id, ...scope, moveType: { tag: "InInvoice" }, state: "Draft", amountResidual: 40, ...extra })

test("selects only exact scoped incoming receipts and PO-owned vendor bills", () => {
  const result = purchaseOrderHandoffs(order, scope, [
    receipt(12n), receipt(11n), receipt(13n, { purchaseId: 6n }),
    receipt(14n, { companyId: 4n }), receipt(15n, { organizationId: 2n }),
    receipt(16n, { isReturn: true }), receipt(17n, { state: "cancel" }),
    receipt(18n, { pickingCode: "outgoing" }),
  ], [
    bill(21n), bill(22n, { companyId: 4n }), bill(23n, { organizationId: 2n }),
    bill(24n, { moveType: "InRefund" }), bill(25n, { state: "Cancelled" }),
    bill(26n, { invoiceOrigin: "PO5" }),
  ])
  assert.deepEqual(result.pickings.map((row) => row.id), [11n, 12n])
  assert.deepEqual(result.invoices.map((row) => row.id), [21n])
  assert.equal(result.invoices[0]?.residual, 40)
})

test("supports snake-case projections, option IDs and IDs above Number precision", () => {
  const id = "9007199254740993"
  const result = purchaseOrderHandoffs(
    { id: "5", organization_id: "1", company_id: "3", invoice_ids: [id, id, "invalid"] }, scope,
    [{ id: "7", organization_id: "1", company_id: "3", purchase_id: { some: "5" }, picking_code: "incoming", state: { tag: "Done" } }],
    [{ id, organization_id: "1", company_id: "3", move_type: "InInvoice", state: "Posted", amount_residual: "25" }],
  )
  assert.deepEqual(result.pickings.map((row) => row.id), [7n])
  assert.deepEqual(result.invoices.map((row) => row.id), [9007199254740993n])
  assert.equal(result.invoices[0]?.residual, 25)
})

test("fails closed for an absent relation or wrong-scope parent; never matches names", () => {
  assert.deepEqual(purchaseOrderHandoffs({ ...order, companyId: 4n }, scope, [receipt(1n)], [bill(21n)]), { pickings: [], invoices: [] })
  assert.deepEqual(purchaseOrderHandoffs({ ...order, invoiceIds: undefined }, scope, [], [bill(21n)]).invoices, [])
  assert.deepEqual(purchaseOrderHandoffs({ ...order, id: "invalid" }, scope, [receipt(1n)], [bill(21n)]), { pickings: [], invoices: [] })
  assert.deepEqual(purchaseOrderHandoffs(order, scope, [], []), { pickings: [], invoices: [] })
})
