import assert from "node:assert/strict"
import test from "node:test"

import { orderHandoffs, orderToCashRows, stateName, timestampMicros, type OrderToCashScope } from "./order-to-cash"

const scope: OrderToCashScope = { organizationId: 1n, companyId: 3n }
const NOW = 2_000_000_000_000_000n

const order = (id: bigint, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: 1n,
  companyId: 3n,
  state: { tag: "Sale" },
  reference: `SO${id}`,
  partnerId: 9n,
  ...extra,
})
const picking = (id: bigint, saleId: bigint | null, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: 1n,
  companyId: 3n,
  saleId,
  state,
  isReturn: false,
  name: `WH/OUT/${id}`,
  ...extra,
})
const invoice = (id: bigint, saleOrderId: bigint | null, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: 1n,
  companyId: 3n,
  saleOrderId,
  moveType: { tag: "OutInvoice" },
  state: { tag: "Posted" },
  paymentState: { tag: "NotPaid" },
  amountResidual: 100,
  invoiceDateDue: { __timestamp_micros_since_unix_epoch__: 1_000_000_000_000_000 },
  name: `INV/${id}`,
  ...extra,
})

test("normalises states and timestamps", () => {
  assert.equal(stateName("Done"), "done")
  assert.equal(stateName({ tag: "Posted" }), "posted")
  assert.equal(stateName({ outInvoice: [] }), "outinvoice")
  assert.equal(stateName(undefined), "")
  assert.equal(timestampMicros({ some: { microsSinceUnixEpoch: 5n } }), 5n)
  assert.equal(timestampMicros({ none: [] }), null)
  assert.equal(timestampMicros("2026-01-01T00:00:00Z"), 1_767_225_600_000_000n)
  assert.equal(timestampMicros(null), null)
})

test("links deliveries and invoices by exact foreign key within scope", () => {
  const handoffs = orderHandoffs(
    5n,
    scope,
    [
      picking(12n, 5n, "done"),
      picking(11n, 5n, "assigned"),
      picking(13n, 6n, "done"),
      picking(14n, 5n, "done", { companyId: 4n }),
      picking(15n, 5n, "done", { organizationId: 2n }),
      picking(16n, 5n, "done", { isReturn: true }),
      picking(17n, 5n, "cancel"),
      picking(18n, null, "done"),
    ],
    [
      invoice(21n, 5n),
      invoice(22n, 6n),
      invoice(23n, 5n, { moveType: { tag: "OutRefund" } }),
      invoice(24n, 5n, { state: { tag: "Cancelled" } }),
      invoice(25n, 5n, { companyId: 4n }),
    ],
  )
  assert.deepEqual(handoffs.pickings.map((p) => p.id), [11n, 12n])
  assert.deepEqual(handoffs.invoices.map((i) => i.id), [21n])
})

test("reads snake_case rows", () => {
  const handoffs = orderHandoffs(
    5n,
    scope,
    [{ id: "7", organization_id: "1", company_id: "3", sale_id: "5", state: "done", is_return: false }],
    [{ id: "8", organization_id: "1", company_id: "3", sale_order_id: "5", move_type: "OutInvoice", state: "Posted", amount_residual: "40" }],
  )
  assert.deepEqual(handoffs.pickings.map((p) => p.id), [7n])
  assert.equal(handoffs.invoices[0]?.residual, 40)
})

test("an order without a delivery is an exception at the to-deliver stage", () => {
  const [row] = orderToCashRows([order(5n)], [], [], [], scope, NOW)
  assert.equal(row?.stage, "to_deliver")
  assert.deepEqual(row?.exceptions, ["no_delivery"])
})

test("an unfinished delivery is an exception", () => {
  const [row] = orderToCashRows([order(5n)], [picking(1n, 5n, "done"), picking(2n, 5n, "assigned")], [], [], scope, NOW)
  assert.equal(row?.stage, "to_deliver")
  assert.deepEqual(row?.exceptions, ["delivery_incomplete"])
})

test("delivered but not invoiced, and a draft invoice does not count", () => {
  const pickings = [picking(1n, 5n, "done")]
  const [row] = orderToCashRows([order(5n)], pickings, [invoice(2n, 5n, { state: { tag: "Draft" } })], [], scope, NOW)
  assert.equal(row?.stage, "to_invoice")
  assert.deepEqual(row?.exceptions, ["not_invoiced"])
})

test("an overdue open invoice is a collection exception with its balance", () => {
  const [row] = orderToCashRows([order(5n)], [picking(1n, 5n, "done")], [invoice(2n, 5n, { amountResidual: 75 })], [], scope, NOW)
  assert.equal(row?.stage, "to_collect")
  assert.deepEqual(row?.exceptions, ["collection_overdue"])
  assert.equal(row?.openBalance, 75)
})

test("an open invoice not yet due is to-collect without an exception", () => {
  const future = { __timestamp_micros_since_unix_epoch__: 3_000_000_000_000_000 }
  const [row] = orderToCashRows([order(5n)], [picking(1n, 5n, "done")], [invoice(2n, 5n, { invoiceDateDue: future })], [], scope, NOW)
  assert.equal(row?.stage, "to_collect")
  assert.deepEqual(row?.exceptions, [])
})

test("a paid invoice settles the order", () => {
  const [row] = orderToCashRows([order(5n)], [picking(1n, 5n, "done")], [invoice(2n, 5n, { amountResidual: 0, paymentState: { tag: "Paid" } })], [], scope, NOW)
  assert.equal(row?.stage, "settled")
  assert.deepEqual(row?.exceptions, [])
  assert.equal(row?.openBalance, 0)
})

test("a credit hold on the customer is an exception for its orders only", () => {
  const holds = [{ organizationId: 1n, companyId: 3n, partnerId: 9n, paymentHold: true }, { organizationId: 1n, companyId: 3n, partnerId: 10n, paymentHold: false }]
  const rows = orderToCashRows([order(5n), order(6n, { partnerId: 10n }), order(7n, { partnerId: 11n })], [], [], holds, scope, NOW)
  assert.deepEqual(rows.map((row) => row.exceptions.includes("credit_hold")), [true, false, false])
  const otherCompany = [{ organizationId: 1n, companyId: 4n, partnerId: 9n, paymentHold: true }]
  assert.equal(orderToCashRows([order(5n)], [], [], otherCompany, scope, NOW)[0]?.exceptions.includes("credit_hold"), false)
})

test("only confirmed or locked orders of the company are order-to-cash", () => {
  const rows = orderToCashRows(
    [
      order(1n, { state: { tag: "Draft" } }),
      order(2n, { state: { tag: "Sent" } }),
      order(3n, { state: { tag: "ToApproval" } }),
      order(4n, { state: { tag: "Cancelled" } }),
      order(5n, { state: { tag: "Done" } }),
      order(6n),
      order(7n, { companyId: 4n }),
      order(8n, { organizationId: 2n }),
    ],
    [],
    [],
    [],
    scope,
    NOW,
  )
  assert.deepEqual(rows.map((row) => row.orderId), [5n, 6n])
})

test("orders are ordered by id", () => {
  const rows = orderToCashRows([order(9n), order(2n), order(5n)], [], [], [], scope, NOW)
  assert.deepEqual(rows.map((row) => row.orderId), [2n, 5n, 9n])
})
