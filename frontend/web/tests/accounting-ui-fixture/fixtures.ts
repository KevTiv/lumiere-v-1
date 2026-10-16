import type { AccountantOverviewData, OverviewCollection, OverviewRow } from "../../app/(modules)/accounting/accountant-overview-model"

const ready = (rows: OverviewRow[]): OverviewCollection => ({ rows, state: { status: "ready" } })
const scope = { organizationId: 1, companyId: 1 }

/** Deliberately synthetic, scoped UI data; never inserted into an ERP database. */
export const overviewFixture: AccountantOverviewData = {
  organizationId: 1,
  companyId: 1n,
  moves: ready([
    { ...scope, id: 101, name: "INV/2026/0101", moveType: "OutInvoice", state: "Posted", amountTotal: 2400, amountResidual: 1200, currencyId: 1, invoiceDate: "2026-09-01", invoiceDateDue: "2026-10-01" },
    { ...scope, id: 102, name: "INV/2026/0102", moveType: "OutInvoice", state: "Posted", amountTotal: 800, amountResidual: 800, currencyId: 2, invoiceDate: "2026-09-15", invoiceDateDue: "2026-10-05" },
    { ...scope, id: 103, name: "Draft customer invoice", moveType: "OutInvoice", state: "Draft", amountTotal: 1250, amountResidual: 1250, currencyId: 1, invoiceDate: "2026-10-16" },
    { ...scope, id: 104, name: "Draft supplier bill", moveType: "InInvoice", state: "Draft", amountTotal: 450, amountResidual: 450, currencyId: 1, invoiceDate: "2026-10-15" },
    { ...scope, id: 105, name: "BILL/2026/0201", moveType: "InInvoice", state: "Posted", amountTotal: 700, amountResidual: 700, currencyId: 1, invoiceDate: "2026-10-14", invoiceDateDue: "2026-10-30" },
    { ...scope, companyId: 99, id: 999, name: "OTHER COMPANY MUST STAY HIDDEN", moveType: "OutInvoice", state: "Posted", amountResidual: 999999, currencyId: 1, invoiceDateDue: "2026-01-01" },
  ]),
  payments: { rows: [], state: { status: "denied", message: "Synthetic permission boundary" } },
  bankStatements: ready([{ ...scope, id: 201, name: "Main EUR bank — October" }]),
  bankLines: ready([
    { id: 301, statementId: 201, name: "Incoming Acme transfer", amount: 1200, currencyId: 1, isReconciled: false },
    { id: 302, statementId: 201, name: "Matched bank fee", amount: -15, currencyId: 1, isReconciled: true },
  ]),
  deadlines: ready([{ ...scope, id: 401, name: "Quarterly VAT return", status: "Pending", dueDate: "2026-10-31" }]),
  periods: ready([{ ...scope, id: 501, name: "October 2026", state: "Open" }]),
  currencies: ready([{ id: 1, name: "EUR" }, { id: 2, name: "USD" }]),
}

export const fixtureNow = new Date("2026-10-16T12:00:00Z")
