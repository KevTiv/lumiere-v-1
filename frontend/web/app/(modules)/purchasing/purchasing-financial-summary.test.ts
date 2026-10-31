import assert from "node:assert/strict"
import { test } from "node:test"
import { purchasingFinancialSummary, purchasingReviewCounts } from "./purchasing-financial-summary"

const scope = { organizationId: 1n, companyId: 2n }
const period = { startMs: Date.parse("2026-10-01"), endMs: Date.parse("2026-10-30") }
const previous = { startMs: Date.parse("2026-09-01"), endMs: period.startMs }
const currencies = new Map([["1", "USD"], ["2", "RWF"], ["3", "KWD"]])
const states = { orders: { status: "ready" as const }, currencies: { status: "ready" as const } }
const order = (patch: object = {}) => ({ ...scope, id: "7", partnerId: "8", name: "PO Seven", state: "Purchase", dateOrder: "2026-10-20", currencyId: "1", amountTotal: 12.34, ...patch })
const summary = (rows: ReturnType<typeof order>[]) => purchasingFinancialSummary(rows, currencies, scope, period, previous, "en-US", states)

test("purchasing values keep currencies separate, use ISO precision and include only scoped confirmed orders in the selected period", () => {
  const result = summary([order(), order({ id: "8", currencyId: "2", amountTotal: 1200 }),
    order({ id: "9", currencyId: "3", amountTotal: 1.123 }), order({ id: "10", companyId: 3n, amountTotal: 999 }),
    order({ id: "11", organizationId: 3n, amountTotal: 999 }), order({ id: "12", state: "Draft", amountTotal: 999 }),
    order({ id: "13", state: "Cancelled", amountTotal: 999 }), order({ id: "14", dateOrder: "2026-08-01", amountTotal: 999 })])
  assert.equal(result.value, "KWD 1.123 · RWF 1,200 · USD 12.34")
  assert.equal(result.change, undefined)
  assert.deepEqual(result.vendors.map((row) => row.value), ["KWD 1.123", "RWF 1,200", "USD 12.34"])
  assert.equal(result.openOrders[0].value, "USD 12.34")
})

test("vendor order-value ranking occurs only within each currency without rounding away precision", () => {
  const result = summary([order({ id: "1", partnerId: "10", currencyId: "3", amountTotal: 1.123 }),
    order({ id: "2", partnerId: "11", currencyId: "3", amountTotal: 2.234 }),
    order({ id: "3", partnerId: "12", currencyId: "2", amountTotal: 10000 })])
  assert.deepEqual(result.vendors.map((row) => [row.currency, row.vendorId, row.value]), [["KWD", "11", "KWD 2.234"], ["KWD", "10", "KWD 1.123"], ["RWF", "12", "RWF 10,000"]])
})

test("comparisons require the same single currency and never count the current-period boundary twice", () => {
  assert.equal(summary([order({ amountTotal: 20 }), order({ id: "8", amountTotal: 10, dateOrder: "2026-09-20" })]).change, 100)
  assert.equal(summary([order({ amountTotal: 20 }), order({ id: "8", amountTotal: 10, dateOrder: "2026-09-20", currencyId: "2" })]).change, undefined)
  assert.equal(summary([order({ dateOrder: "2026-10-01" })]).change, undefined)
})

test("missing amounts/currency/dates, duplicates and stale/denied reads never become reassuring zero totals", () => {
  for (const patch of [{ amountTotal: undefined }, { amountTotal: "" }, { amountTotal: Infinity }, { amountTotal: false },
    { currencyId: "999" }, { currencyId: undefined }, { dateOrder: undefined }, { companyId: undefined }]) {
    assert.equal(summary([order(patch)]).status, "unavailable")
    assert.equal(summary([order(patch)]).value, "—")
  }
  assert.equal(summary([order(), order()]).status, "unavailable")
  for (const status of ["loading", "error", "denied", "partial"] as const) {
    for (const field of ["orders", "currencies"] as const) {
      const result = purchasingFinancialSummary([order()], currencies, scope, period, previous, "en-US", { ...states, [field]: { status } })
      assert.equal(result.status, "unavailable")
      assert.equal(result.value, "—")
      assert.deepEqual(result.vendors, [])
      assert.deepEqual(result.openOrders, [])
    }
  }
  assert.equal(summary([order({ amountTotal: 0 })]).value, "USD 0.00")
  assert.equal(summary([]).value, "—")
})

test("missing vendors suppress ranking without losing exact confirmed order value or merging unknown vendors", () => {
  const result = summary([order({ partnerId: undefined }), order({ id: "8", partnerId: undefined, amountTotal: 2 })])
  assert.equal(result.status, "ready")
  assert.equal(result.value, "USD 14.34")
  assert.equal(result.vendorsStatus, "unavailable")
  assert.deepEqual(result.vendors, [])
  assert.equal(result.openOrders[0].vendorId, "")
  assert.equal(summary([order()]).vendorsStatus, "ready")
})

const ready = { status: "ready" as const }
const review = (patch: Partial<Parameters<typeof purchasingReviewCounts>[0]> = {}) => purchasingReviewCounts({
  orders: { rows: [order({ receiptStatus: "partial", datePlanned: "2026-10-25" })], state: ready },
  toApprove: { rows: [order({ state: "ToApprove" })], state: ready },
  partialReceipt: { rows: [order({ receiptStatus: "partial" })], state: ready },
  overBilled: { rows: [order({ state: "Confirmed", orderId: "7" })], state: ready },
  ...patch,
}, scope, period, previous, Date.parse("2026-10-30"))

test("operational counts reject incomplete scope, duplicate identities and unreadable states across every source", () => {
  const exact = review()
  assert.deepEqual([exact.open, exact.pendingReceipt, exact.toApprove, exact.partialReceipt, exact.overBilled], [1, 1, 1, 1, 1])
  for (const field of ["orders", "toApprove", "partialReceipt", "overBilled"] as const) {
    for (const patch of [{ id: undefined }, { companyId: undefined }, { organizationId: undefined }, { state: undefined }]) {
      const candidate = order({ receiptStatus: "partial", ...patch })
      const result = review({ [field]: { rows: [candidate], state: ready } })
      assert.equal(field === "orders" ? result.open : result[field], null)
    }
    const candidate = order({ state: field === "toApprove" ? "ToApprove" : field === "overBilled" ? "Confirmed" : "Purchase", receiptStatus: "partial", orderId: "7" })
    const duplicate = review({ [field]: { rows: [candidate, candidate], state: ready } })
    assert.equal(field === "orders" ? duplicate.open : duplicate[field], null)
    for (const status of ["loading", "error", "denied", "partial"] as const) {
      const result = review({ [field]: { rows: [candidate], state: { status } } })
      assert.equal(field === "orders" ? result.open : result[field], null)
    }
    const foreign = review({ [field]: { rows: [{ ...candidate, companyId: 3n }], state: ready } })
    assert.equal(field === "orders" ? foreign.open : foreign[field], 0)
    const empty = review({ [field]: { rows: [], state: ready } })
    assert.equal(field === "orders" ? empty.open : empty[field], 0)
  }
})

test("complete operational counts remain usable with masked money, while missing receipt/date inputs gate only affected metrics", () => {
  const candidate = order({ amountTotal: undefined, currencyId: undefined, receiptStatus: "partial", datePlanned: "2026-10-25" })
  const counts = review({ orders: { rows: [candidate], state: ready } })
  assert.equal(counts.open, 1)
  assert.equal(counts.pendingReceipt, 1)
  assert.equal(counts.receivedOrNotDue, 0)
  assert.equal(summary([candidate]).status, "unavailable")
  const maskedReceipt = review({ orders: { rows: [{ ...candidate, receiptStatus: undefined }], state: ready } })
  assert.equal(maskedReceipt.open, 1)
  assert.equal(maskedReceipt.pendingReceipt, null)
  assert.equal(maskedReceipt.receivedOrNotDue, null)
  const maskedDate = review({ orders: { rows: [{ ...candidate, dateOrder: undefined, datePlanned: undefined }], state: ready } })
  assert.equal(maskedDate.open, 1)
  assert.equal(maskedDate.pendingReceipt, 1)
  assert.equal(maskedDate.change, undefined)
  assert.equal(maskedDate.receivedOrNotDue, null)
})
