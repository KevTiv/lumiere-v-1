import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles"
import { normalizedTag } from "@lumiere/erp-workflows"
import {
  projectPaymentAllocations,
  type PaymentAllocationBalance,
  type PaymentAllocationRow,
} from "@lumiere/erp-shared/payment-allocation-projection"

/** Read projection: enumerate supported fields while retaining runtime redaction checks. */
export interface OverviewRow extends PaymentAllocationRow {
  id?: unknown
  organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
  currencyId?: unknown; currency_id?: unknown
  state?: unknown; status?: unknown
  moveType?: unknown; move_type?: unknown
  paymentType?: unknown; payment_type?: unknown
  amountTotal?: unknown; amount_total?: unknown
  amount?: unknown
  amountResidual?: unknown; amount_residual?: unknown
  invoiceDate?: unknown; invoice_date?: unknown
  invoiceDateDue?: unknown; invoice_date_due?: unknown
  dueDate?: unknown; due_date?: unknown
  date?: unknown; createdAt?: unknown; createDate?: unknown; create_date?: unknown
  deletedAt?: unknown; deleted_at?: unknown
  name?: unknown; title?: unknown; ref?: unknown; reference?: unknown; code?: unknown
  statementId?: unknown; statement_id?: unknown
  journalId?: unknown; journal_id?: unknown
  balanceEndReal?: unknown; balance_end_real?: unknown; balanceEnd?: unknown; balance_end?: unknown
  decimalPlaces?: unknown; decimal_places?: unknown
  dateFrom?: unknown; date_from?: unknown; dateTo?: unknown; date_to?: unknown
  totalPlanned?: unknown; total_planned?: unknown; totalPractical?: unknown; total_practical?: unknown
  isReconciled?: unknown; is_reconciled?: unknown
  reconciledInvoiceIds?: unknown; reconciled_invoice_ids?: unknown
  reconciledBillIds?: unknown; reconciled_bill_ids?: unknown
  allocationBalance?: PaymentAllocationBalance
}
export interface OverviewCollection {
  rows: readonly OverviewRow[]
  state: ModuleDataState
}
export interface AccountantOverviewData {
  organizationId: number
  companyId: bigint | string
  moves: OverviewCollection
  payments: OverviewCollection
  /** Canonical ledger residual plus operational correction history; never inferred from invoice links. */
  paymentAllocationSources?: {
    moveLines: OverviewCollection
    transactions: OverviewCollection
    reversals: OverviewCollection
  }
  bankStatements: OverviewCollection
  bankLines: OverviewCollection
  deadlines: OverviewCollection
  periods: OverviewCollection
  currencies: OverviewCollection
  companies?: OverviewCollection
  budgets?: OverviewCollection
}
export type OverviewQueueKey = "overdue" | "bills-due" | "draft-invoices" | "draft-bills" | "bank-lines" | "unlinked-payments" | "deadlines" | "periods"
export interface OverviewActivityMonth {
  startMs: number
  invoices: number
  bills: number
}

export function overviewTag(value: unknown): string {
  return normalizedTag(value)
}
function cell(row: OverviewRow, camel: keyof OverviewRow, snake: keyof OverviewRow): unknown {
  return row[camel] ?? row[snake]
}
function id(value: unknown): string {
  if (value != null && typeof value === "object" && "some" in value) return id(value.some)
  return value == null ? "" : String(value)
}
export function overviewNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
export function overviewResidual(row: OverviewRow): number | null {
  return overviewNumber(cell(row, "amountResidual", "amount_residual"))
}
export function overviewDate(row: OverviewRow): Date | null {
  return kpiDate(row.invoiceDate ?? row.invoice_date ?? row.date ?? row.createdAt ?? row.createDate ?? row.create_date)
}
export function overviewDueDate(row: OverviewRow): Date | null {
  return kpiDate(row.invoiceDateDue ?? row.invoice_date_due ?? row.dueDate ?? row.due_date)
}
export function overviewLabel(row: OverviewRow): string {
  return String(row.name ?? row.title ?? row.ref ?? row.reference ?? `#${String(row.id ?? "")}`)
}
function unavailable(collection: OverviewCollection): OverviewCollection {
  return collection.state.status === "ready" ? collection : { rows: [], state: collection.state }
}
function scoped(collection: OverviewCollection, data: AccountantOverviewData, allowOrganizationWide = false): OverviewCollection {
  const read = unavailable(collection)
  if (!allowOrganizationWide && read.rows.some((row) => {
    const org = id(cell(row, "organizationId", "organization_id"))
    return (!org || org === String(data.organizationId)) && !id(cell(row, "companyId", "company_id"))
  })) return { rows: [], state: { status: "partial" } }
  return {
    state: read.state,
    rows: read.rows.filter((row) => {
      const org = id(cell(row, "organizationId", "organization_id"))
      const company = id(cell(row, "companyId", "company_id"))
      return (!org || org === String(data.organizationId)) &&
        (company === String(data.companyId) || (allowOrganizationWide && !company)) &&
        row.deletedAt == null && row.deleted_at == null
    }),
  }
}
function bucket(source: OverviewCollection, matches: (row: OverviewRow) => boolean, complete?: (row: OverviewRow) => boolean): OverviewCollection {
  if (source.state.status !== "ready") return { rows: [], state: source.state }
  // Field-redacted and incomplete rows cannot turn into reassuring zero totals.
  if (complete && source.rows.some((row) => !complete(row))) {
    return { rows: [], state: { status: "partial", message: "Some required fields are unavailable." } }
  }
  return { state: source.state, rows: source.rows.filter(matches) }
}

/** Derive operating queues only from successful, company-scoped reads. */
export function buildAccountantOverview(data: AccountantOverviewData, now = new Date()) {
  const moves = scoped(data.moves, data)
  const moveFields = (row: OverviewRow) => overviewTag(row.state) !== "" && overviewTag(cell(row, "moveType", "move_type")) !== ""
  const isType = (row: OverviewRow, type: string) => overviewTag(cell(row, "moveType", "move_type")) === type
  const posted = bucket(moves, (row) => overviewTag(row.state) === "posted", moveFields)
  const invoices = bucket(posted, (row) => isType(row, "outinvoice"))
  const bills = bucket(posted, (row) => isType(row, "ininvoice"))
  const residualKnown = (row: OverviewRow) => overviewResidual(row) != null && id(cell(row, "currencyId", "currency_id")) !== ""
  const receivables = bucket(invoices, (row) => (overviewResidual(row) ?? 0) > 0, residualKnown)
  const payables = bucket(bills, (row) => (overviewResidual(row) ?? 0) > 0, residualKnown)
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const overdue = bucket(receivables, (row) => {
    const due = overviewDueDate(row)
    return due != null && due.getTime() < today.getTime()
  })
  // UTC calendar days: overdue plus all bills due through seven days from today.
  const billsDue = bucket(payables, (row) => {
    const due = overviewDueDate(row)
    return due != null && due.getTime() < today.getTime() + 8 * 86_400_000
  })
  const statements = scoped(data.bankStatements, data)
  const statementsById = new Map(statements.rows.map((row) => [id(row.id), row]))
  const bankSource: OverviewCollection = data.bankLines.state.status !== "ready"
    ? { rows: [], state: data.bankLines.state }
    : statements.state.status !== "ready"
      ? { rows: [], state: statements.state }
      : { state: { status: "ready" }, rows: data.bankLines.rows.filter((row) => {
        const org = id(cell(row, "organizationId", "organization_id"))
        return (!org || org === String(data.organizationId)) && statementsById.has(id(cell(row, "statementId", "statement_id")))
      }) }
  const unmatched = bucket(bankSource,
    (row) => cell(row, "isReconciled", "is_reconciled") === false,
    (row) => typeof cell(row, "isReconciled", "is_reconciled") === "boolean")
  const missingAllocationRead: OverviewCollection = { rows: [], state: { status: "partial", message: "Payment allocation sources are unavailable." } }
  const allocationProjection = projectPaymentAllocations({
    organizationId: data.organizationId, companyId: data.companyId, payments: data.payments,
    moves: data.moves, currencies: data.currencies,
    moveLines: data.paymentAllocationSources?.moveLines ?? missingAllocationRead,
    transactions: data.paymentAllocationSources?.transactions ?? missingAllocationRead,
    reversals: data.paymentAllocationSources?.reversals ?? missingAllocationRead,
  })
  const unallocatedPayments: OverviewCollection = {
    state: allocationProjection.state,
    rows: allocationProjection.rows.filter((balance) => balance.remainingMinor > 0n)
      .map((balance) => ({ ...balance.row, allocationBalance: balance })),
  }
  const activeDeadlines = bucket(scoped(data.deadlines, data, true), (row) => {
    const status = overviewTag(row.status)
    const due = overviewDueDate(row)
    return !["completed", "waived"].includes(status) && due != null && due.getTime() <= now.getTime() + 30 * 86_400_000
  }, (row) => overviewTag(row.status) !== "" && overviewDueDate(row) != null)
  const openPeriods = bucket(scoped(data.periods, data), (row) => overviewTag(row.state) === "open", (row) => overviewTag(row.state) !== "")
  const draftInvoices = bucket(moves, (row) => overviewTag(row.state) === "draft" && isType(row, "outinvoice"), moveFields)
  const draftBills = bucket(moves, (row) => overviewTag(row.state) === "draft" && isType(row, "ininvoice"), moveFields)
  const recent = bucket(moves, (row) => ["outinvoice", "ininvoice", "outrefund", "inrefund"].includes(overviewTag(cell(row, "moveType", "move_type"))), moveFields)
  const activityDocuments = bucket(bucket(posted, (row) => isType(row, "outinvoice") || isType(row, "ininvoice")), () => true, (row) => overviewDate(row) != null)
  const months: OverviewActivityMonth[] = activityDocuments.state.status === "ready" ? Array.from({ length: 6 }, (_, index) => ({
    startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1), invoices: 0, bills: 0,
  })) : []
  for (const row of activityDocuments.rows) {
    const date = overviewDate(row)!
    if (date.getTime() > now.getTime()) continue
    const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    const month = months.find((point) => point.startMs === monthStart)
    if (month) { if (isType(row, "outinvoice")) month.invoices += 1; else month.bills += 1 }
  }
  const queues: Record<OverviewQueueKey, OverviewCollection> = {
    overdue, "bills-due": billsDue, "draft-invoices": draftInvoices, "draft-bills": draftBills, "bank-lines": unmatched,
    "unlinked-payments": unallocatedPayments, deadlines: activeDeadlines, periods: openPeriods,
  }
  return {
    receivables, payables, overdue, unmatched, queues, statementsById,
    activity: { state: activityDocuments.state, months },
    recent: { ...recent, rows: [...recent.rows].sort((a, b) => (overviewDate(b)?.getTime() ?? 0) - (overviewDate(a)?.getTime() ?? 0)).slice(0, 6) },
  }
}

export interface OverviewMoneyTotal { currencyId: string; currencyLabel: string; amount: number }
/** Currency IDs remain distinct even if the currency lookup is denied or incomplete. */
export function overviewMoneyTotals(rows: readonly OverviewRow[], currencies: OverviewCollection, amountOf: (row: OverviewRow) => number | null = overviewResidual): OverviewMoneyTotal[] {
  const labels = new Map(unavailable(currencies).rows.map((row) => [id(row.id), String(row.code ?? row.name ?? "")]))
  const totals = new Map<string, number>()
  for (const row of rows) {
    const currencyId = id(cell(row, "currencyId", "currency_id"))
    const amount = amountOf(row)
    if (amount == null) continue
    totals.set(currencyId, (totals.get(currencyId) ?? 0) + amount)
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currencyId, amount]) => ({
    currencyId, amount, currencyLabel: labels.get(currencyId) || (currencyId ? `Currency #${currencyId}` : "Currency unspecified"),
  }))
}
