import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAccountantOverview, overviewMoneyTotals,
  type AccountantOverviewData, type OverviewCollection, type OverviewRow,
} from "./accountant-overview-model"

const NOW = new Date("2026-10-16T12:00:00Z")
const read = (rows: OverviewRow[] = []): OverviewCollection => ({ rows, state: { status: "ready" } })
const move = (id: number, extra: OverviewRow = {}): OverviewRow => ({
  id, organizationId: 42, companyId: 7, moveType: { tag: "OutInvoice" }, state: { tag: "Posted" },
  amountResidual: 100, amountTotal: 150, currencyId: 1, invoiceDateDue: "2026-10-15", ...extra,
})
function data(extra: Partial<AccountantOverviewData> = {}): AccountantOverviewData {
  return {
    organizationId: 42, companyId: 7n, moves: read(), payments: read(), bankStatements: read(),
    bankLines: read(), deadlines: read(), periods: read(), currencies: read([{ id: 1, name: "EUR" }, { id: 2, name: "USD" }]), ...extra,
  }
}

test("receivables exclude drafts, cancelled, credit notes, paid and out-of-scope invoices", () => {
  const result = buildAccountantOverview(data({ moves: read([
    move(1), move(2, { state: "Draft" }), move(3, { state: "Cancelled" }),
    move(4, { amountResidual: 0 }), move(5, { moveType: "OutRefund" }),
    move(6, { companyId: 8 }), move(7, { organizationId: 43 }),
    move(8, { moveType: "InInvoice" }),
  ]) }), NOW)
  assert.deepEqual(result.receivables.rows.map((row) => row.id), [1])
  assert.deepEqual(result.payables.rows.map((row) => row.id), [8])
  assert.deepEqual(result.queues["draft-invoices"].rows.map((row) => row.id), [2])
})

test("overdue excludes invoices due today, future or without a due date", () => {
  const result = buildAccountantOverview(data({ moves: read([
    move(1), move(2, { invoiceDateDue: "2026-10-16" }), move(3, { invoiceDateDue: "2026-10-17" }),
    move(4, { invoiceDateDue: null }),
    move(5, { invoiceDateDue: { microsSinceUnixEpoch: BigInt(Date.parse("2026-10-14")) * 1000n } }),
  ]) }), NOW)
  assert.deepEqual(result.overdue.rows.map((row) => row.id), [1, 5])
})

test("SATS unit enum objects and snake-case move types share the same queue predicates", () => {
  const result = buildAccountantOverview(data({ moves: read([
    move(1, { state: { posted: [] }, moveType: { outInvoice: [] } }),
    move(2, { state: "posted", moveType: "out_invoice" }),
  ]) }), NOW)
  assert.deepEqual(result.receivables.rows.map((row) => row.id), [1, 2])
})

test("currency IDs stay separate when the currency lookup is unavailable", () => {
  const totals = overviewMoneyTotals([move(1), move(2, { currencyId: 2, amountResidual: 75 })], {
    state: { status: "denied" }, rows: [{ id: 1, name: "Cached secret label" }],
  })
  assert.deepEqual(totals, [
    { currencyId: "1", currencyLabel: "Currency #1", amount: 100 },
    { currencyId: "2", currencyLabel: "Currency #2", amount: 75 },
  ])
  assert.deepEqual(overviewMoneyTotals([move(1), move(2, { currencyId: 2 })], data().currencies).map((total) => total.currencyLabel), ["EUR", "USD"])
})

test("denied, failed, loading and stale inputs never produce zero summaries or cached record links", () => {
  for (const status of ["denied", "error", "loading", "partial"] as const) {
    const result = buildAccountantOverview(data({ moves: { rows: [move(1)], state: { status } } }), NOW)
    assert.equal(result.receivables.state.status, status)
    assert.equal(result.recent.state.status, status)
    assert.deepEqual(result.receivables.rows, [])
    assert.deepEqual(result.queues["draft-invoices"].rows, [])
  }
})

test("an unavailable payment source does not hide valid invoice balances", () => {
  const result = buildAccountantOverview(data({
    moves: read([move(1)]), payments: { rows: [], state: { status: "denied" } },
  }), NOW)
  assert.equal(result.receivables.state.status, "ready")
  assert.equal(result.receivables.rows.length, 1)
  assert.equal(result.queues["unlinked-payments"].state.status, "denied")
})

test("bank lines inherit company scope from their parent statement, never from an absent field", () => {
  const input = data({ bankStatements: read([{ id: 10, companyId: 7 }, { id: 11, companyId: 8 }]), bankLines: read([
    { id: 1, statementId: 10, isReconciled: false }, { id: 2, statementId: 10, isReconciled: true },
    { id: 3, statementId: 11, isReconciled: false }, { id: 4, statementId: 99, isReconciled: false },
    { id: 5, statementId: 10, organizationId: 43, isReconciled: false },
  ]) })
  assert.deepEqual(buildAccountantOverview(input, NOW).unmatched.rows.map((row) => row.id), [1])
  input.bankStatements.state = { status: "denied" }
  const denied = buildAccountantOverview(input, NOW).unmatched
  assert.equal(denied.state.status, "denied")
  assert.deepEqual(denied.rows, [])
})

test("unlinked payments require posted state, ordinary direction and both explicit empty link arrays", () => {
  const payment = (id: number, extra: OverviewRow = {}) => ({ id, companyId: 7, state: "Paid", paymentType: "Inbound", reconciledInvoiceIds: [], reconciledBillIds: [], ...extra })
  const result = buildAccountantOverview(data({ payments: read([
    payment(1), payment(2, { state: "NotPaid" }), payment(3, { state: "Reversed" }),
    payment(4, { paymentType: "Transfer" }), payment(5, { reconciledInvoiceIds: [100] }),
    payment(6, { reconciledBillIds: [101] }), payment(7, { companyId: 8 }),
  ]) }), NOW)
  assert.deepEqual(result.queues["unlinked-payments"].rows.map((row) => row.id), [1])
  const redacted = buildAccountantOverview(data({ payments: read([payment(8, { reconciledBillIds: undefined })]) }), NOW)
  assert.equal(redacted.queues["unlinked-payments"].state.status, "partial")
})

test("a missing residual or reconciliation flag is unavailable rather than an invented zero", () => {
  const result = buildAccountantOverview(data({ moves: read([move(1, { amountResidual: undefined })]) }), NOW)
  assert.equal(result.receivables.state.status, "partial")
  assert.deepEqual(result.receivables.rows, [])
  const bank = buildAccountantOverview(data({ bankStatements: read([{ id: 10, companyId: 7 }]), bankLines: read([{ id: 1, statementId: 10 }]) }), NOW)
  assert.equal(bank.unmatched.state.status, "partial")
  const currency = buildAccountantOverview(data({ moves: read([move(1, { currencyId: undefined })]) }), NOW)
  assert.equal(currency.receivables.state.status, "partial")
  const company = buildAccountantOverview(data({ moves: read([move(1, { companyId: undefined })]) }), NOW)
  assert.equal(company.receivables.state.status, "partial")
})

test("tax queue includes organization deadlines, excludes completed, deleted, other companies and distant dates", () => {
  const deadline = (id: number, extra: OverviewRow = {}) => ({ id, organizationId: 42, companyId: 7, status: "Pending", dueDate: "2026-10-20", ...extra })
  const result = buildAccountantOverview(data({ deadlines: read([
    deadline(1), deadline(2, { companyId: undefined }), deadline(3, { companyId: 8 }),
    deadline(4, { status: "Completed" }), deadline(5, { status: "Waived" }), deadline(6, { dueDate: "2027-01-01" }),
    deadline(7, { deletedAt: "2026-10-10" }),
  ]) }), NOW)
  assert.deepEqual(result.queues.deadlines.rows.map((row) => row.id), [1, 2])
})

test("activity counts posted invoice and bill documents in six UTC calendar months, without adding currencies", () => {
  const result = buildAccountantOverview(data({ moves: read([
    move(1, { invoiceDate: "2026-05-01T00:00:00Z", currencyId: 1 }),
    move(2, { invoiceDate: "2026-10-01", currencyId: 2 }),
    move(3, { invoiceDate: "2026-10-15", moveType: "InInvoice" }),
    move(4, { invoiceDate: "2026-10-15", state: "Draft" }),
    move(5, { invoiceDate: "2026-04-30T23:59:59Z" }),
    move(6, { invoiceDate: "2026-10-20" }),
    move(7, { invoiceDate: "2026-10-15", companyId: 8 }),
    move(8, { invoiceDate: "2026-10-15", moveType: "OutRefund" }),
  ]) }), NOW)
  assert.deepEqual(result.activity.months, [
    { startMs: Date.UTC(2026, 4, 1), invoices: 1, bills: 0 },
    { startMs: Date.UTC(2026, 5, 1), invoices: 0, bills: 0 },
    { startMs: Date.UTC(2026, 6, 1), invoices: 0, bills: 0 },
    { startMs: Date.UTC(2026, 7, 1), invoices: 0, bills: 0 },
    { startMs: Date.UTC(2026, 8, 1), invoices: 0, bills: 0 },
    { startMs: Date.UTC(2026, 9, 1), invoices: 1, bills: 1 },
  ])
})

test("activity distinguishes an empty successful period from unavailable or undated documents", () => {
  const empty = buildAccountantOverview(data(), NOW).activity
  assert.equal(empty.state.status, "ready")
  assert.equal(empty.months.length, 6)
  const denied = buildAccountantOverview(data({ moves: { rows: [move(1)], state: { status: "denied" } } }), NOW).activity
  assert.equal(denied.state.status, "denied")
  assert.deepEqual(denied.months, [])
  const undated = buildAccountantOverview(data({ moves: read([move(1)]) }), NOW).activity
  assert.equal(undated.state.status, "partial")
  assert.deepEqual(undated.months, [])
})
