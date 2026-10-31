import assert from "node:assert/strict"
import test from "node:test"
import { buildModuleInsights, insightRecordHref, type InsightModule, type InsightRecord, type InsightSource, type ModuleInsightInput } from "./module-insights-model"

const now = new Date("2026-10-17T12:00:00Z")
const read = (rows: InsightRecord[] = []): InsightSource => ({ rows, state: { status: "ready" } })
const row = (id: string | number, extra: InsightRecord = {}): InsightRecord => ({ id, organizationId: 1, companyId: 7, currencyId: 1, companyCurrencyId: 1, name: `Record ${id}`, state: "Draft", amountTotal: 100, totalAmount: 100, expectedRevenue: 100, isWon: false, isLost: false, dateOrder: "2026-10-01", createdAt: "2026-10-01", createDate: "2026-10-01", dateDeadline: null, datePlanned: null, receiptStatus: "pending", ...extra })
const data = (module: InsightModule, records: InsightRecord[] = [], extra: Partial<ModuleInsightInput> = {}): ModuleInsightInput => ({ module, organizationId: 1, companyId: 7n, records: read(records), currencies: read([{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }]), ...extra })

test("Sales measures confirmed orders by order date, not quotations, cancelled orders or a revenue/AR approximation", () => {
  const model = buildModuleInsights(data("sales", [row(1), row(2, { state: { tag: "Sale" }, amountTotal: 250 }), row(3, { state: "Done", amountTotal: 500 }), row(4, { state: "Cancelled" }), row(5, { state: "Sent" }), row(6, { state: "ToApprove" })]), 30, "1", now)
  assert.equal(model.period.value?.current, 750)
  assert.equal(model.periodCounts.value?.current, 2)
  assert.equal(model.totals.value?.amount, 200)
  assert.equal(model.counts.value?.current, 2)
  assert.deepEqual(model.queues.value?.map((queue) => [queue.key, queue.records.length]), [["draft", 1], ["sent", 1], ["toapprove", 1]])
})

test("CRM separates open pipeline from currently open/won opportunity-creation cohorts and excludes unassigned company records", () => {
  const model = buildModuleInsights(data("crm", [row(1), row(2, { isWon: true, expectedRevenue: 400 }), row(3, { isLost: true }), row(4, { companyId: null }), row(5, { dateDeadline: "2026-10-16" }), row(6, { dateDeadline: "2026-10-17" })]), 30, "1", now)
  assert.equal(model.totals.value?.amount, 300)
  assert.equal(model.period.value?.current, 700)
  assert.deepEqual(model.queues.value?.find((queue) => queue.key === "overdue")?.records.map((item) => item.id), ["5"])
  assert.deepEqual(model.queues.value?.find((queue) => queue.key === "open")?.records.map((item) => item.id), ["1", "5", "6"])
  assert.equal(buildModuleInsights(data("crm", [row(1, { isWon: undefined })]), 30, "1", now).counts.value, null)
  assert.equal(buildModuleInsights(data("crm", [row(1, { isWon: true, isLost: true })]), 30, "1", now).counts.value, null)
})

test("Purchasing late receipts exclude fully received POs and RFQs; due today is not late", () => {
  const sample = data("purchasing", [row(1, { state: "Purchase", datePlanned: "2026-10-16" }), row(2, { state: "Purchase", receiptStatus: "full", datePlanned: "2026-10-01" }), row(3, { state: "Purchase", datePlanned: "2026-10-17" }), row(4, { state: "Done" }), row(5, { datePlanned: "2026-10-01" })])
  const model = buildModuleInsights(sample, 30, "1", now)
  assert.equal(model.period.value?.current, 400)
  assert.equal(model.counts.value?.current, 3)
  assert.deepEqual(model.queues.value?.find((queue) => queue.key === "late")?.records.map((item) => item.id), ["1"])
  assert.equal(buildModuleInsights(data("purchasing", [row(1, { state: "Purchase", receiptStatus: undefined })]), 30, "1", now).queues.value, null)
})

test("Expenses aggregates report headers once, excludes drafts/refusals from activity and keeps submitted claims current", () => {
  const model = buildModuleInsights(data("expenses", [row(1), row(2, { state: "Submitted", totalAmount: 25 }), row(3, { state: "Approved", totalAmount: 75 }), row(4, { state: "Refused", totalAmount: 900 }), row(5, { state: "Posted", totalAmount: 50 })]), 30, "1", now)
  assert.equal(model.period.value?.current, 150)
  assert.equal(model.totals.value?.amount, 25)
  assert.equal(model.periodCounts.value?.current, 3)
  assert.deepEqual(model.queues.value?.map((queue) => queue.records.length), [1, 1, 1])
})

test("Reports counts creation activity across currencies without needing money, currencies or report-data reads", () => {
  const model = buildModuleInsights(data("reports", [row(1), row(2, { state: "Generated", currencyId: 2, amountTotal: undefined }), row(3, { state: "Exported" }), row(4, { state: "Archived" })], { currencies: { rows: [], state: { status: "denied" } } }), 30, undefined, now)
  assert.equal(model.monetary, false)
  assert.equal(model.period.value?.current, 4)
  assert.equal(model.periodCounts.value?.current, 2)
  assert.equal(model.totals.value?.amount, 2)
  assert.equal(model.counts.value?.current, 1)
})

for (const module of ["sales", "crm", "purchasing", "expenses", "reports"] as const) {
  test(`${module}: exact company/org scope, deleted/foreign rows and u64 links cannot leak across boundaries`, () => {
    const model = buildModuleInsights(data(module, [row("9007199254740992"), row("9007199254740993"), row(3, { companyId: 8 }), row(4, { organizationId: 2 }), row(5, { deletedAt: "2026-10-16" })]), 30, "1", now)
    assert.equal(model.counts.value?.total, 2)
    assert.deepEqual(model.recent.value?.map((item) => item.id), ["9007199254740992", "9007199254740993"])
    assert.ok(insightRecordHref(module, "9007199254740993").includes("9007199254740993"))
    for (const records of [[row(1, { organizationId: undefined })], [row(1, { companyId: undefined })], [row(1), row(1)], [row(1, module === "crm" ? { isLost: undefined } : { state: undefined })]]) assert.equal(buildModuleInsights(data(module, records), 30, "1", now).counts.value, null)
    assert.equal(buildModuleInsights(data(module, [row(1)], { companyId: 0n }), 30, "1", now).counts.value, null)
  })
  test(`${module}: denied/loading/error/partial sources discard every cached figure, chart, queue and recent record`, () => {
    for (const status of ["denied", "loading", "error", "partial"] as const) {
      const model = buildModuleInsights(data(module, [], { records: { rows: [row(1)], state: { status } } }), 30, "1", now)
      for (const panel of [model.totals, model.counts, model.period, model.queues, model.recent]) assert.equal(panel.value, null)
      if (status === "denied") assert.equal(model.counts.state.status, "denied")
    }
  })
}

test("Currency IDs stay separate despite identical labels; minor-unit arithmetic and catalog precision are authoritative", () => {
  const first = "9007199254740992", second = "9007199254740993"
  const sample = data("expenses", [row(1, { state: "Submitted", currencyId: first, totalAmount: 0.1 }), row(2, { state: "Submitted", currencyId: first, totalAmount: 0.2 }), row(3, { state: "Submitted", currencyId: second, totalAmount: 900 })], { currencies: read([{ id: first, code: "SAME", decimalPlaces: 2 }, { id: second, code: "SAME", decimalPlaces: 2 }]) })
  assert.equal(buildModuleInsights(sample, 30, first, now).totals.value?.amount, 0.3)
  assert.equal(buildModuleInsights(sample, 30, second, now).totals.value?.amount, 900)
  for (const [code, decimals, value] of [["KWD", 3, 1.001], ["JPY", 0, 150]] as const) {
    const precision = data("sales", [row(1, { state: "Sale", amountTotal: value })], { currencies: read([{ id: 1, code, decimalPlaces: decimals }]) })
    assert.equal(buildModuleInsights(precision, 30, "1", now).period.value?.current, value)
  }
  const missing = buildModuleInsights(data("sales", [row(1)], { currencies: read([{ id: 1, code: "EUR" }]) }), 30, "1", now)
  assert.equal(missing.totals.value, null)
  assert.equal(missing.counts.value?.total, 1)
  for (const value of [undefined, null, true, "", " ", "0x10", Infinity, "NaN", 0.001, Number.MAX_SAFE_INTEGER]) assert.equal(buildModuleInsights(data("sales", [row(1, { state: "Sale", amountTotal: value })]), 30, "1", now).period.value, null, String(value))
  const overflow = buildModuleInsights(data("sales", [row(1, { state: "Sale", amountTotal: 50_000_000_000_000 }), row(2, { state: "Sale", amountTotal: 50_000_000_000_000 })]), 30, "1", now)
  assert.equal(overflow.period.value, null)
})

test("UTC comparison windows are disjoint, include today in progress, reject missing dates and do not extrapolate partial months", () => {
  const model = buildModuleInsights(data("sales", [row(1, { state: "Sale", dateOrder: "2026-09-18", amountTotal: 150 }), row(2, { state: "Sale", dateOrder: "2026-09-17", amountTotal: 300 }), row(3, { state: "Sale", dateOrder: "2026-10-17", amountTotal: 50 }), row(4, { state: "Sale", dateOrder: "2026-10-18", amountTotal: 999 })]), 30, "1", now)
  assert.equal(model.startMs, Date.parse("2026-09-18T00:00:00Z"))
  assert.equal(model.period.value?.current, 200)
  assert.equal(model.period.value?.previous, 300)
  assert.deepEqual(model.period.value?.months.map((item) => item.value), [150, 50])
  assert.equal(buildModuleInsights(data("sales", [row(1, { state: "Sale", dateOrder: undefined })]), 30, "1", now).period.value, null)
  assert.equal(buildModuleInsights(data("sales", []), 30, "1", now).period.value?.percent, null)
})

test("Queue previews use exact numeric ID ordering and preserve canonical record links", () => {
  const model = buildModuleInsights(data("sales", [row(10), row(2), row("9007199254740993")]), 90, "1", now)
  assert.deepEqual(model.queues.value?.[0]?.records.map((item) => item.id), ["2", "10", "9007199254740993"])
  assert.equal(insightRecordHref("expenses", "9007199254740993"), "/expenses/reports/9007199254740993")
})


test("Company currency is the dashboard default; explicit selection and currency boundaries remain intact", () => {
  const currencies = read([{ id: 1, code: "USD", decimalPlaces: 2 }, { id: 2, code: "RWF", decimalPlaces: 0 }])
  const empty = data("expenses", [], { companyCurrencyId: 2, currencies })
  const model = buildModuleInsights(empty, 30, undefined, now)
  assert.equal(model.selectedId, "2")
  assert.equal(model.currency?.label, "RWF")
  assert.equal(model.totals.value?.amount, 0)
  const mixed = data("expenses", [row(1, { state: "Submitted", totalAmount: 10 }), row(2, { state: "Submitted", currencyId: 2, totalAmount: 900 })], { companyCurrencyId: 2, currencies })
  assert.equal(buildModuleInsights(mixed, 30, undefined, now).totals.value?.amount, 900)
  assert.equal(buildModuleInsights(mixed, 30, "1", now).totals.value?.amount, 10)
  assert.equal(buildModuleInsights(data("expenses", [row(1, { currencyId: undefined })], { companyCurrencyId: 2, currencies }), 30, undefined, now).totals.value, null)
  assert.equal(buildModuleInsights({ ...empty, companyCurrencyId: 99 }, 30, undefined, now).selectedId, "1")
})
