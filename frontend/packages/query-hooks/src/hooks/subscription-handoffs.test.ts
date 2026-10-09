import assert from "node:assert/strict"
import test from "node:test"
import { subscriptionHandoffs } from "./subscription-handoffs"

const scope = { organizationId: 1n, companyId: 3n }
const subscription = { id: 5n, ...scope }
const run = (invoiceMoveId: bigint, extra = {}) => ({ id: invoiceMoveId + 100n, ...scope, subscriptionId: 5n, invoiceMoveId, ...extra })
const invoice = (id: bigint, extra = {}) => ({ id, ...scope, moveType: "OutInvoice", state: "Posted", ...extra })
const payment = (id: bigint, reconciledInvoiceIds: bigint[], extra = {}) => ({ id, ...scope, state: "Paid", reconciledInvoiceIds, ...extra })

test("links exact billing-run invoices and reconciled payments, including partial/multi-invoice payments", () => {
  const result = subscriptionHandoffs(subscription, scope, [run(12n), run(11n), run(11n), run(13n, { subscriptionId: 6n })],
    [invoice(11n), invoice(12n), invoice(13n)],
    [payment(22n, [12n]), payment(21n, [11n, 13n]), payment(23n, [13n]), payment(24n, [])])
  assert.deepEqual(result.invoices.map((row) => row.id), [11n, 12n])
  assert.deepEqual(result.payments.map((row) => row.id), [21n, 22n])
  assert.equal(result.unavailable, false)
})

test("scope-checks the parent, billing runs, invoices and payments independently", () => {
  const result = subscriptionHandoffs(subscription, scope,
    [run(11n), run(12n, { companyId: 4n }), run(13n, { organizationId: 2n })],
    [invoice(11n), invoice(12n), invoice(13n)],
    [payment(21n, [11n], { companyId: 4n }), payment(22n, [11n], { organizationId: 2n }), payment(23n, [11n])])
  assert.deepEqual(result.invoices.map((row) => row.id), [11n])
  assert.deepEqual(result.payments.map((row) => row.id), [23n])
  assert.equal(subscriptionHandoffs({ ...subscription, companyId: 4n }, scope, [run(11n)], [invoice(11n)], []).unavailable, true)
  assert.equal(subscriptionHandoffs(subscription, scope, [run(11n)], [invoice(11n, { companyId: 4n })], []).unavailable, true)
})

test("does not infer invoices or payments from names, references, pending approval or reversal", () => {
  const result = subscriptionHandoffs(subscription, scope, [run(11n)],
    [invoice(11n), invoice(12n, { invoiceOrigin: "SUB5" })],
    [payment(21n, [], { ref: "SUB5-PAY-11" }), payment(22n, [11n], { state: "NotPaid" }), payment(23n, [11n], { state: "Reversed" })])
  assert.deepEqual(result.invoices.map((row) => row.id), [11n])
  assert.deepEqual(result.payments, [])
})

test("reports missing/ambiguous invoice relations, suppresses ambiguous payments and excludes cancelled/refund moves", () => {
  assert.equal(subscriptionHandoffs(subscription, scope, [run(11n)], [], []).unavailable, true)
  assert.equal(subscriptionHandoffs(subscription, scope, [run(11n)], [invoice(11n), invoice(11n)], []).unavailable, true)
  assert.equal(subscriptionHandoffs(subscription, scope, [run(11n, { invoiceMoveId: null })], [], []).unavailable, true)
  assert.equal(subscriptionHandoffs(subscription, scope, [run(11n)], [invoice(11n, { moveType: "OutRefund" })], []).unavailable, true)
  const result = subscriptionHandoffs(subscription, scope, [run(11n), run(12n)],
    [invoice(11n), invoice(12n, { state: "Cancelled" })],
    [payment(21n, [11n]), payment(21n, [11n]), payment(22n, [12n])])
  assert.deepEqual(result.invoices.map((row) => row.id), [11n])
  assert.deepEqual(result.payments, [])
  assert.equal(result.unavailable, true)
  assert.deepEqual(subscriptionHandoffs(subscription, scope, [], [], []), { invoices: [], payments: [], unavailable: false })
})

test("supports snake-case option IDs and preserves IDs above Number precision", () => {
  const id = "9007199254740993"
  const result = subscriptionHandoffs(subscription, scope,
    [{ organization_id: "1", company_id: "3", subscription_id: { some: "5" }, invoice_move_id: { some: id } }],
    [{ id, organization_id: "1", company_id: "3", move_type: { tag: "OutInvoice" }, state: { tag: "Posted" } }],
    [{ id: "9007199254740994", organization_id: "1", company_id: "3", state: { tag: "Paid" }, reconciled_invoice_ids: [id] }])
  assert.equal(result.invoices[0]?.id, 9007199254740993n)
  assert.equal(result.payments[0]?.id, 9007199254740994n)
  assert.equal(result.unavailable, false)
})
