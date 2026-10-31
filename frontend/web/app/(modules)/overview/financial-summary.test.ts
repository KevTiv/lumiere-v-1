import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { confirmedOrderTrend, overviewFinancialInputsComplete, overviewMoneySummary, overduePostedInvoices } from "./financial-summary"

describe("overview financial meaning", () => {
  it("keeps transaction currencies separate and preserves currency precision", () => {
    const currencies = new Map([["1", "USD"], ["2", "RWF"], ["3", "KWD"]])
    const result = overviewMoneySummary([
      { currencyId: "1", amountTotal: 12.34 }, { currencyId: "1", amountTotal: 2 },
      { currencyId: "2", amountTotal: 1200 }, { currencyId: "3", amountTotal: 1.123 },
    ], currencies, "amountTotal", "en-US")
    assert.equal(result, "KWD 1.123 · RWF 1,200 · USD 14.34")
  })

  it("does not invent zero amounts or currencies for incomplete projections", () => {
    const currencies = new Map([["1", "USD"]])
    for (const row of [{ currencyId: "1" }, { amountTotal: 12 }, { currencyId: "1", amountTotal: "" }, { currencyId: "1", amountTotal: Infinity }])
      assert.equal(overviewMoneySummary([row], currencies, "amountTotal", "en-US"), null)
    assert.equal(overviewMoneySummary([{ currencyId: "1", amountTotal: 0 }], currencies, "amountTotal", "en-US"), "USD 0.00")
  })

  it("counts only posted unpaid customer invoices with a known prior-day due date", () => {
    const base = { state: { tag: "Posted" }, moveType: { tag: "OutInvoice" }, amountResidual: 12 }
    const rows = [
      { ...base, invoiceDateDue: "2026-10-28", name: "overdue" },
      { ...base, invoiceDateDue: "2026-10-29", name: "today" },
      { ...base, invoiceDateDue: null, name: "unknown" },
      { ...base, invoiceDateDue: "2026-10-28", state: { tag: "Draft" }, name: "draft" },
      { ...base, invoiceDateDue: "2026-10-28", amountResidual: 0, name: "paid" },
      { ...base, invoiceDateDue: "2026-10-28", moveType: { tag: "InInvoice" }, name: "bill" },
    ]
    assert.deepEqual(overduePostedInvoices(rows, new Date("2026-10-29T15:00:00Z")).map((row) => row.name), ["overdue"])
  })

  it("does not treat redacted eligibility fields as a confirmed empty queue", () => {
    assert.equal(overviewFinancialInputsComplete([{ state: "Posted", moveType: "OutInvoice", invoiceDateDue: null }], "invoices"), false)
    assert.equal(overviewFinancialInputsComplete([{ state: "Posted", moveType: "OutInvoice", amountResidual: 0 }], "invoices"), false)
    assert.equal(overviewFinancialInputsComplete([{ state: "Posted", moveType: "OutInvoice", amountResidual: 0, invoiceDateDue: null }], "invoices"), true)
    assert.equal(overviewFinancialInputsComplete([{ state: "Sale" }], "orders"), false)
    assert.equal(overviewFinancialInputsComplete([{ state: "Sale", dateOrder: "2026-10-29" }], "orders"), true)
  })

  it("counts orders without combining money and separates the same month in different years", () => {
    const series = confirmedOrderTrend([
      { state: "Sale", dateOrder: "2026-10-10", currencyId: 1, amountTotal: 50 },
      { state: "Done", dateOrder: { microsSinceUnixEpoch: 1791676800000000n }, currencyId: 2, amountTotal: 5000 },
      { state: "Sale", dateOrder: "2025-10-10" },
      { state: "Draft", dateOrder: "2026-10-10" },
      { state: "Sale", dateOrder: "2026-11-01" },
    ], new Date("2026-10-29T15:00:00Z"), "en-US")
    assert.ok(series.length <= 36)
    assert.equal(new Set(series.map((point) => point.label)).size, series.length)
    assert.equal(series.reduce((sum, point) => sum + point.value, 0), 2)
  })

  it("uses the selected historical range and its exact end boundary for the trend", () => {
    const rows = [
      { state: "Sale", dateOrder: "2022-06-01" },
      { state: "Done", dateOrder: "2023-12-31T23:59:59.999Z" },
      { state: "Sale", dateOrder: "2024-01-01" },
      { state: "Sale", createDate: "2022-06-01" },
    ]
    const period = { kind: "custom" as const, from: "2022-01-01", through: "2023-12-31" }
    const selected = confirmedOrderTrend(rows, new Date("2026-10-29"), "en-US", period)
    assert.equal(selected.reduce((sum, point) => sum + point.value, 0), 2)
    assert.ok(selected.length <= 36)
    const all = confirmedOrderTrend(rows, new Date("2026-10-29"), "en-US", "all")
    assert.equal(all.reduce((sum, point) => sum + point.value, 0), 3)
  })

  it("keeps a timestamp just before epoch on its historical business day", () => {
    const rows = [{ state: "Sale", dateOrder: { microsSinceUnixEpoch: -1n } }]
    const before = confirmedOrderTrend(rows, new Date("2026-10-29"), "en-US", { kind: "custom", from: "1969-12-31", through: "1969-12-31" })
    const after = confirmedOrderTrend(rows, new Date("2026-10-29"), "en-US", { kind: "custom", from: "1970-01-01", through: "1970-01-01" })
    assert.equal(before.reduce((sum, point) => sum + point.value, 0), 1)
    assert.equal(after.reduce((sum, point) => sum + point.value, 0), 0)
  })
})
