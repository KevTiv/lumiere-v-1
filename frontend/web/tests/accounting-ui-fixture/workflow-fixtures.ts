import { resolveInvoiceProfile, type InvoiceDocumentSnapshot } from "@lumiere/erp-shared/invoice-personalization"
import type { AccountMove } from "../../../packages/ui/src/lib/accounting-types"
import type { ReconciliationSource } from "../../../packages/ui/src/accounting-components/reconciliation-workbench-model"

const timestamp = (date: string) => ({ microsSinceUnixEpoch: BigInt(Date.parse(`${date}T00:00:00Z`)) * 1000n })
type ScopedFixtureMove = AccountMove & { organizationId: string; companyId: string; currencyId: string }

/** Deliberately includes foreign rows and adjacent u64 IDs. Production projections must preserve scope and exact identity. */
export const workflowInvoices: ScopedFixtureMove[] = [
  { organizationId: "7", companyId: "11", id: "9007199254740993", name: "INV/SYNTHETIC/9007199254740993", invoicePartnerDisplayName: "Synthetic international customer with a deliberately long account name", moveType: "OutInvoice", state: "Posted", paymentState: "NotPaid", currencyId: "1", amountTotal: 600, amountResidual: 600, invoiceDate: timestamp("2026-10-01"), invoiceDateDue: timestamp("2000-01-01") },
  { organizationId: "7", companyId: "11", id: "9007199254740992", name: "INV/SYNTHETIC/9007199254740992", invoicePartnerDisplayName: "Synthetic USD customer", moveType: "OutInvoice", state: "Posted", paymentState: "Partial", currencyId: "2", amountTotal: 400, amountResidual: 200, invoiceDate: timestamp("2026-10-02"), invoiceDateDue: timestamp("2999-01-01") },
  { organizationId: "7", companyId: "11", id: "103", name: "INV/SYNTHETIC/DRAFT", invoicePartnerDisplayName: "Synthetic draft customer", moveType: "OutInvoice", state: "Draft", paymentState: "NotPaid", currencyId: "1", amountTotal: 150, amountResidual: 150, invoiceDate: timestamp("2026-10-03") },
  { organizationId: "7", companyId: "22", id: "999", name: "COMPANY B INVOICE", invoicePartnerDisplayName: "Other company customer", moveType: "OutInvoice", state: "Posted", paymentState: "NotPaid", currencyId: "1", amountTotal: 999999, amountResidual: 999999 },
  { organizationId: "8", companyId: "11", id: "998", name: "FOREIGN ORGANIZATION MUST STAY HIDDEN", moveType: "OutInvoice", state: "Posted", currencyId: "1", amountTotal: 888888, amountResidual: 888888 },
]

export const workflowBills: ScopedFixtureMove[] = [
  { organizationId: "7", companyId: "11", id: "201", name: "BILL/SYNTHETIC/0201", invoicePartnerDisplayName: "Synthetic international supplier", moveType: "InInvoice", state: "Posted", paymentState: "NotPaid", currencyId: "1", amountTotal: 1000, amountResidual: 1000, invoiceDate: timestamp("2026-10-04"), invoiceDateDue: timestamp("2000-01-01") },
  { organizationId: "7", companyId: "11", id: "202", name: "BILL/SYNTHETIC/DRAFT", invoicePartnerDisplayName: "Synthetic draft supplier", moveType: "InInvoice", state: "Draft", paymentState: "NotPaid", currencyId: "2", amountTotal: 250, amountResidual: 250 },
  { organizationId: "7", companyId: "22", id: "299", name: "COMPANY B BILL", moveType: "InInvoice", state: "Posted", currencyId: "1", amountTotal: 777777, amountResidual: 777777 },
]

export const workflowCurrencies = [{ value: "1", code: "EUR", label: "Euro (EUR)" }, { value: "2", code: "USD", label: "US dollar (USD)" }]

const scope = { organizationId: "7", companyId: "11" }
const bankLine = { id: "301", organizationId: "7", statementId: "201", journalId: "5", date: timestamp("2026-10-16"), amount: 1000, amountCurrency: null, currencyId: null, journalCurrencyId: "1", foreignCurrencyId: null, isReconciled: false, moveIds: [], transactionType: "Synthetic incoming transfer for international accounting support" }

export const reconciliationFixture: ReconciliationSource = {
  organizationId: "7", companyId: "11", companyCurrencyId: "1", state: { status: "ready" },
  statement: { ...scope, id: "201", name: "Synthetic EUR bank statement with a deliberately long review label", state: "Open", journalId: "5", currencyId: "1" },
  line: bankLine, bankLines: [bankLine],
  currencies: [{ id: "1", code: "EUR", name: "Euro", decimalPlaces: 2, roundingFactor: 0.01 }, { id: "2", code: "USD", name: "US dollar", decimalPlaces: 2, roundingFactor: 0.01 }],
  accounts: [{ ...scope, id: "401", code: "1200", name: "Synthetic receivables", reconcile: true, deprecated: false }],
  moves: [
    { ...scope, id: "9007199254740993", name: "INV/SYNTHETIC/9007199254740993", state: "Posted", moveType: "OutInvoice", invoicePartnerDisplayName: "Synthetic customer A" },
    { ...scope, id: "9007199254740992", name: "INV/SYNTHETIC/9007199254740992", state: "Posted", moveType: "OutInvoice", invoicePartnerDisplayName: "Synthetic customer B" },
    { ...scope, companyId: "22", id: "999", name: "FOREIGN RECONCILIATION RECORD", state: "Posted" },
  ],
  moveLines: [
    { ...scope, id: "501", moveId: "9007199254740993", accountId: "401", name: "Synthetic first installment", parentState: "Posted", companyCurrencyId: "1", currencyId: "1", balance: 600, debit: 600, credit: 0, amountResidual: 600, blocked: false },
    { ...scope, id: "502", moveId: "9007199254740992", accountId: "401", name: "Synthetic second installment", parentState: "Posted", companyCurrencyId: "1", currencyId: "1", balance: 400, debit: 400, credit: 0, amountResidual: 400, blocked: false },
    { ...scope, companyId: "22", id: "599", moveId: "999", accountId: "401", name: "FOREIGN COMPANY MATCH MUST STAY HIDDEN", parentState: "Posted", companyCurrencyId: "1", currencyId: "1", balance: 1000, debit: 1000, credit: 0, amountResidual: 1000, blocked: false },
    { ...scope, id: "598", moveId: "9007199254740992", accountId: "401", name: "FOREIGN CURRENCY MATCH MUST STAY HIDDEN", parentState: "Posted", companyCurrencyId: "1", currencyId: "2", balance: 1000, debit: 1000, credit: 0, amountResidual: 1000, blocked: false },
  ],
  suggestions: [{ organizationId: "7", statementLineId: "301", entityId: "501" }],
}

const profile = resolveInvoiceProfile({ notice: "Synthetic buyer snapshot layout — not a financial acceptance record.", footer: "Synthetic document footer" })
const seller = { name: "Synthetic seller", address: ["1 Synthetic Street", "Example City"], taxId: "SYNTHETIC-SELLER-TAX", registrationNumber: "SYNTHETIC-SELLER-REG", email: "seller@example.test", phone: "", website: "" }
export const legacyBuyerSnapshot: InvoiceDocumentSnapshot = { schemaVersion: 1, profileVersionIds: { organization: "1", company: "2" }, profile, seller, notes: "Synthetic legacy invoice notes" }
export const capturedBuyerSnapshot: InvoiceDocumentSnapshot = {
  schemaVersion: 2, profileVersionIds: { organization: "1", company: "2" }, profile, seller, notes: "Synthetic invoice-only notes",
  buyer: { partnerId: "601", name: "Captured Buyer Legal Identity Limited", address: ["10 Captured Legal Street", "Captured Buyer City", "RW"], taxId: "CAPTURED-BUYER-TAX", registrationNumber: "CAPTURED-BUYER-REG", email: "captured-buyer@example.test", phone: "+250000000001" },
}
