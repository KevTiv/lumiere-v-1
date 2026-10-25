import assert from "node:assert/strict"
import test from "node:test"
import { buildAccountantInsights } from "./accountant-insights-model"
import type { AccountantOverviewData, OverviewCollection, OverviewRow } from "./accountant-overview-model"

const now = new Date("2026-10-16T12:00:00Z")
const read = (rows: OverviewRow[] = []): OverviewCollection => ({ rows, state: { status: "ready" } })
const invoice = (id: number | string, extra: OverviewRow = {}): OverviewRow => ({ id, organizationId: 42, companyId: 7, currencyId: 1, moveType: "OutInvoice", state: "Posted", amountTotal: 150, amountResidual: 100, invoiceDate: "2026-10-01", invoiceDateDue: "2026-10-15", ...extra })
const budget = (id: number, extra: OverviewRow = {}): OverviewRow => ({ id, organizationId: 42, companyId: 7, name: `Budget ${id}`, state: "Validate", dateFrom: "2026-01-01", dateTo: "2026-12-31", totalPlanned: 1000, totalPractical: 750, ...extra })
function data(extra: Partial<AccountantOverviewData> = {}): AccountantOverviewData {
  return { organizationId: 42, companyId: 7n, moves: read(), payments: read(), bankStatements: read(), bankLines: read(), deadlines: read(), periods: read(),
    currencies: read([{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }]), companies: read([{ id: 7, organizationId: 42, currencyId: 1 }]), budgets: read(), ...extra }
}

test("financial amounts remain company/org/currency scoped and exclude drafts, cancellations, refunds and future activity", () => {
  const result = buildAccountantInsights(data({ moves: read([
    invoice(1), invoice(2, { moveType: "InInvoice", amountTotal: 75, amountResidual: 50 }), invoice(3, { currencyId: 2, amountTotal: 900 }),
    invoice(4, { companyId: 8 }), invoice(5, { organizationId: 43 }), invoice(6, { state: "Draft" }), invoice(7, { state: "Cancelled" }), invoice(8, { moveType: "OutRefund" }), invoice(9, { invoiceDate: "2026-10-17" }),
  ]) }), 30, "1", now)
  assert.deepEqual(result.period.value?.invoices, { current: 150, previous: 0, percent: null })
  assert.equal(result.period.value?.bills.current, 75)
  // Balances are the current state of posted documents, not historical-period estimates.
  assert.deepEqual(result.balances.value, { invoices: 200, bills: 50 })
  const usd = buildAccountantInsights(data({ moves: read([invoice(1), invoice(3, { currencyId: 2, amountTotal: 900 })]) }), 30, "2", now)
  assert.equal(usd.period.value?.invoices.current, 900)
})

test("UTC comparison windows do not overlap and partial current months are not extrapolated", () => {
  const sample = data({ moves: read([
    invoice(1, { invoiceDate: "2026-09-17", amountTotal: 60 }), invoice(2, { invoiceDate: "2026-10-16", amountTotal: 90 }),
    invoice(3, { invoiceDate: "2026-09-16", amountTotal: 100 }), invoice(4, { invoiceDate: "2026-08-18", amountTotal: 200 }),
    invoice(5, { invoiceDate: "2026-08-17", amountTotal: 999 }),
  ]) })
  const result = buildAccountantInsights(sample, 30, "1", now)
  assert.deepEqual(result.period.value?.invoices, { current: 150, previous: 300, percent: -50 })
  assert.equal(result.startMs, Date.parse("2026-09-17T00:00:00Z"))
  assert.equal(result.previousStartMs, Date.parse("2026-08-18T00:00:00Z"))
  assert.deepEqual(result.period.value?.months.map((point) => point.invoices), [60, 90])
  assert.equal(buildAccountantInsights(sample, 90, "1", now).balances.value?.invoices, result.balances.value?.invoices)
})

test("zero baselines and successful zero balances remain distinct from unavailable data", () => {
  const result = buildAccountantInsights(data(), 30, "1", now)
  assert.equal(result.period.state.status, "ready")
  assert.deepEqual(result.period.value?.invoices, { current: 0, previous: 0, percent: null })
  assert.deepEqual(result.balances.value, { invoices: 0, bills: 0 })
})

test("currency precision is authoritative and sums are accumulated in exact minor units", () => {
  const sample = data({ moves: read([invoice(1, { amountTotal: 0.1, amountResidual: 0.1 }), invoice(2, { amountTotal: 0.2, amountResidual: 0.2 })]) })
  assert.equal(buildAccountantInsights(sample, 30, "1", now).period.value?.invoices.current, 0.3)
  const kwd = data({ currencies: read([{ id: 1, code: "KWD", decimalPlaces: 3 }]), moves: read([invoice(1, { amountTotal: 1.001, amountResidual: 0.001 })]) })
  assert.equal(buildAccountantInsights(kwd, 30, "1", now).period.value?.invoices.current, 1.001)
  assert.equal(buildAccountantInsights(kwd, 30, "1", now).balances.value?.invoices, 0.001)
  const jpy = data({ currencies: read([{ id: 1, code: "JPY", decimalPlaces: 0 }]), moves: read([invoice(1, { amountTotal: 150, amountResidual: 100 })]) })
  assert.equal(buildAccountantInsights(jpy, 30, "1", now).period.value?.invoices.current, 150)
  const missing = buildAccountantInsights(data({ currencies: read([{ id: 1, code: "EUR" }]) }), 30, "1", now)
  assert.equal(missing.period.value, null)
})

test("malformed, redacted and unsafe amounts never produce invented zeros", () => {
  for (const value of [undefined, null, "", " ", true, false, Infinity, "NaN", "0x10", 0.001, Number.MAX_SAFE_INTEGER]) {
    const result = buildAccountantInsights(data({ moves: read([invoice(1, { amountTotal: value })]) }), 30, "1", now)
    assert.equal(result.period.value, null, String(value))
    assert.equal(result.balances.value?.invoices, 100)
  }
  const residual = buildAccountantInsights(data({ moves: read([invoice(1, { amountResidual: undefined })]) }), 30, "1", now)
  assert.equal(residual.balances.value, null)
  assert.equal(residual.aging.value, null)
  assert.equal(residual.period.value?.invoices.current, 150)
})

test("all aging boundaries, due today, explicit undated values and selected currency reconcile to balances", () => {
  const dates = ["2026-10-16", "2026-10-15", "2026-09-16", "2026-09-15", "2026-08-17", "2026-08-16", "2026-07-18", "2026-07-17", null]
  const result = buildAccountantInsights(data({ moves: read(dates.map((due, index) => invoice(index + 1, { invoiceDateDue: due }))) }), 30, "1", now)
  assert.deepEqual(result.aging.value?.map((point) => point.invoices), [100, 200, 200, 200, 100, 100])
  assert.equal(result.aging.value?.reduce((sum, point) => sum + point.invoices, 0), result.balances.value?.invoices)
  const missing = invoice(99)
  delete missing.invoiceDateDue
  assert.equal(buildAccountantInsights(data({ moves: read([missing]) }), 30, "1", now).aging.value, null)
})

test("denied, loading, stale and failed reads never expose cached financial series", () => {
  for (const status of ["denied", "loading", "partial", "error"] as const) {
    const result = buildAccountantInsights(data({ moves: { rows: [invoice(1)], state: { status } }, budgets: { rows: [budget(1)], state: { status } } }), 30, "1", now)
    assert.equal(result.balances.value, null)
    assert.equal(result.period.value, null)
    assert.equal(result.aging.value, null)
    assert.equal(result.budgets.value, null)
  }
})

test("missing scope, duplicate rows and redacted document classification fail closed; known foreign rows do not poison scope", () => {
  for (const moves of [[invoice(1, { companyId: undefined })], [invoice(1, { organizationId: undefined })], [invoice(1), invoice(1)], [invoice(1, { state: undefined })], [invoice(1, { moveType: undefined })], [invoice(1, { currencyId: undefined })]]) {
    assert.equal(buildAccountantInsights(data({ moves: read(moves) }), 30, "1", now).balances.value, null)
  }
  assert.equal(buildAccountantInsights(data({ moves: read([invoice(1), { companyId: 8, organizationId: 42 }]) }), 30, "1", now).balances.value?.invoices, 100)
  assert.equal(buildAccountantInsights(data({ organizationId: 0 }), 30, "1", now).balances.value, null)
})

test("exact u64 currency identity is preserved even when catalog labels are identical", () => {
  const first = "9007199254740992", second = "9007199254740993"
  const result = buildAccountantInsights(data({ currencies: read([{ id: first, code: "SAME", decimalPlaces: 2 }, { id: second, code: "SAME", decimalPlaces: 2 }]), moves: read([invoice(1, { currencyId: first }), invoice(2, { currencyId: second, amountTotal: 45 })]) }), 30, second, now)
  assert.equal(result.selectedId, second)
  assert.equal(result.period.value?.invoices.current, 45)
  assert.equal(result.currencies.length, 3) // Includes the explicitly configured company currency, without guessing its precision.
})

test("budgets use canonical whole totals, exact scope, eligible states and overlapping dates, never prorated", () => {
  const result = buildAccountantInsights(data({ budgets: read([
    budget(1), budget(2, { state: "Draft" }), budget(3, { state: "Cancel" }), budget(4, { companyId: 8 }), budget(5, { organizationId: 43 }),
    budget(6, { dateFrom: "2027-01-01", dateTo: "2027-12-31" }), budget(7, { dateFrom: "2026-01-01", dateTo: "2026-08-01" }),
    budget(8, { state: "Done", totalPractical: 1100 }),
  ]) }), 30, "1", now)
  assert.deepEqual(result.budgets.value?.map((item) => [item.id, item.planned, item.actual, item.variance]), [["1", 1000, 750, -250], ["8", 1000, 1100, 100]])
})

test("budgets cannot borrow another currency or guessed company defaults", () => {
  for (const sample of [data({ companies: undefined }), data({ companies: { rows: [], state: { status: "denied" } } }), data({ companies: read([{ id: 7, organizationId: 43, currencyId: 1 }]) })]) {
    assert.equal(buildAccountantInsights(sample, 30, "1", now).budgets.value, null)
  }
  const result = buildAccountantInsights(data({ budgets: read([budget(1)]) }), 30, "2", now)
  assert.equal(result.budgets.value, null)
  assert.equal(result.period.state.status, "ready")
})

test("currency read failures hide all monetary charts, while unrelated payment failures do not", () => {
  const denied = buildAccountantInsights(data({ currencies: { rows: [{ id: 1, code: "EUR", decimalPlaces: 2 }], state: { status: "denied" } }, moves: read([invoice(1)]) }), 30, "1", now)
  assert.equal(denied.period.value, null)
  assert.equal(denied.budgets.value, null)
  const payments = buildAccountantInsights(data({ payments: { rows: [], state: { status: "denied" } }, moves: read([invoice(1)]) }), 30, "1", now)
  assert.equal(payments.period.value?.invoices.current, 150)
})

test("aggregate overflow and duplicate currency definitions fail closed", () => {
  const result = buildAccountantInsights(data({ moves: read([invoice(1, { amountTotal: 50_000_000_000_000 }), invoice(2, { amountTotal: 50_000_000_000_000 })]) }), 30, "1", now)
  assert.equal(result.period.value, null)
  const duplicate = buildAccountantInsights(data({ currencies: read([{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 1, code: "EUR", decimalPlaces: 2 }]) }), 30, "1", now)
  assert.equal(duplicate.period.value, null)
})

test("days sales and payables outstanding scale open balances by the period's postings", () => {
  const sample = data({ moves: read([
    invoice(1, { amountTotal: 200, amountResidual: 100 }),
    invoice(2, { moveType: "InInvoice", amountTotal: 100, amountResidual: 50 }),
    invoice(3, { state: "Draft", amountTotal: 999, amountResidual: 999 }),
  ]) })
  assert.deepEqual(buildAccountantInsights(sample, 30, "1", now).turnover.value, { dso: 15, dpo: 15 })
  // Nothing posted in the period: no figure rather than a misleading zero or infinity.
  const quiet = data({ moves: read([invoice(1, { invoiceDate: "2026-06-01", amountTotal: 200, amountResidual: 100 })]) })
  assert.deepEqual(buildAccountantInsights(quiet, 30, "1", now).turnover.value, { dso: null, dpo: null })
})

const statement = (id: number, extra: OverviewRow = {}): OverviewRow => ({ id, organizationId: 42, companyId: 7, currencyId: 1, journalId: 10, state: "Confirm", date: "2026-10-05", balanceEndReal: 700, ...extra })

test("cash position is the latest closing balance per bank journal, with a month-end trend", () => {
  const result = buildAccountantInsights(data({ bankStatements: read([
    statement(1, { date: "2026-09-20", balanceEndReal: 500 }),
    statement(2),
    statement(3, { journalId: 11, date: "2026-10-10", balanceEndReal: 300 }),
    statement(4, { date: "2026-10-20", balanceEndReal: 9999 }),
    statement(5, { state: "Cancel", date: "2026-10-12", balanceEndReal: 8888 }),
    statement(6, { currencyId: 2, balanceEndReal: 7777 }),
    statement(7, { companyId: 8, balanceEndReal: 6666 }),
  ]) }), 30, "1", now)
  assert.equal(result.cash.value?.position, 1000)
  assert.equal(result.cash.value?.accounts, 2)
  assert.equal(result.cash.value?.asOfMs, Date.parse("2026-10-10T00:00:00Z"))
  assert.deepEqual(result.cash.value?.months.map((point) => point.balance), [500, 1000])
})

test("cash is unavailable when a statement lacks its currency or balance, and empty without statements", () => {
  assert.equal(buildAccountantInsights(data({ bankStatements: read([statement(1, { currencyId: undefined })]) }), 30, "1", now).cash.value, null)
  assert.equal(buildAccountantInsights(data({ bankStatements: read([statement(1, { balanceEndReal: undefined })]) }), 30, "1", now).cash.value, null)
  const none = buildAccountantInsights(data(), 30, "1", now).cash.value
  assert.equal(none?.accounts, 0)
  assert.deepEqual(none?.months.map((point) => point.balance), [null, null])
})
