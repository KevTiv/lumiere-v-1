import assert from "node:assert/strict"
import { test } from "node:test"
import { purchasingFinancialSummary } from "./purchasing-financial-summary"

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
