import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { confirmedOrderTrend, overviewFinancialInputsComplete, overviewMoneySummary } from "./financial-summary"
import {
  clearOwnerQueueHref, isDraftVendorBill, isOwnerQueue, lowStockQuants, overduePostedInvoices, ownerQueueHref,
} from "../../../lib/owner-queues"

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
      { ...base, moveType: "out_invoice", invoiceDateDue: "2026-10-28", name: "snake case" },
      { ...base, invoiceDateDue: "2026-10-29", name: "today" },
      { ...base, invoiceDateDue: null, name: "unknown" },
      { ...base, invoiceDateDue: "2026-10-28", state: { tag: "Draft" }, name: "draft" },
      { ...base, invoiceDateDue: "2026-10-28", amountResidual: 0, name: "paid" },
      { ...base, invoiceDateDue: "2026-10-28", moveType: { tag: "InInvoice" }, name: "bill" },
    ]
    assert.deepEqual(overduePostedInvoices(rows, new Date("2026-10-29T15:00:00Z")).map((row) => row.name), ["overdue", "snake case"])
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

describe("owner work queues", () => {
  it("routes to the exact list and removes only the owner queue when clearing", () => {
    const queues = [
      ["overdueInvoices", "/accounting", "invoices", "overdue-invoices"],
      ["draftBills", "/accounting", "bills", "draft-bills"],
      ["lowStockProducts", "/warehouse", "stock", "low-stock"],
    ] as const
    for (const [queue, path, tab, value] of queues) {
      assert.equal(ownerQueueHref(queue), `${path}?tab=${tab}&ownerQueue=${value}`)
      assert.equal(isOwnerQueue(queue, tab, value), true)
      assert.equal(isOwnerQueue(queue, "another-tab", value), false)
      assert.equal(isOwnerQueue(queue, tab, null), false)
      assert.equal(clearOwnerQueueHref(path, `tab=${tab}&ownerQueue=${value}&filter=id%3A8`), `${path}?tab=${tab}&filter=id%3A8`)
    }
  })

  it("selects draft vendor bills across read projections", () => {
    const rows = [
      { id: 1, state: { tag: "Draft" }, moveType: { tag: "InInvoice" } },
      { id: 2, state: "Draft", move_type: "in_invoice" },
      { id: 3, state: "Posted", moveType: "InInvoice" },
      { id: 4, state: "Draft", moveType: "OutInvoice" },
      { id: 5, moveType: "InInvoice" },
    ]
    assert.deepEqual(rows.filter(isDraftVendorBill).map((row) => row.id), [1, 2])
  })

  it("counts only matching stock rows with verified products, company and eligibility", () => {
    const scope = { organizationId: 7n, companyId: 3n }
    const base = { ...scope, productId: 2n, availableQuantity: 5, isOutdated: false }
    const products = [
      { organizationId: 7n, id: 2n, reorderingMinQty: { some: 4 } },
      { organizationId: 7n, id: 3n },
      { organizationId: 7n, id: 4n, reorderingMinQty: { none: [] } },
      { organizationId: 9n, id: 5n },
    ]
    const stock = [
      { ...base, id: 1, availableQuantity: 4 },
      { ...base, id: 2, isOutdated: { tag: "True" } },
      { ...base, id: 3, isOutdated: { tag: "False" } },
      { ...base, id: 4, availableQuantity: undefined, isOutdated: undefined },
      { ...base, id: 5, productId: 3n, availableQuantity: 0 },
      { ...base, id: 6, productId: 4n, availableQuantity: 0 },
      { ...base, id: 7, productId: 0n, isOutdated: true },
      { ...base, id: 8, productId: 5n, isOutdated: true },
      { ...base, id: 9, organizationId: 9n, isOutdated: true },
      { ...base, id: 10, companyId: 4n, isOutdated: true },
      { ...base, id: 11, availableQuantity: "" },
    ]
    assert.deepEqual(lowStockQuants(stock, products, scope).map((row) => row.id), [1, 2, 5])
    assert.deepEqual(lowStockQuants(stock, products, { ...scope, companyId: null }), [])
  })
})
