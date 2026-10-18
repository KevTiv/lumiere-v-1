import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"

/** Shared setup/create lookups stay live while actions can be opened from any workspace. */
export const ACCOUNTING_SHARED_READS = [
  "account-accounts", "account-moves", "account-taxes", "tax-groups", "account-account-types",
  "account-journals", "account-periods", "fiscal-years", "account-payment-terms",
  "companies", "currencies", "sale-orders", "contacts", "products",
] as const

/** Include joined labels, form options and operational panel reads, not just each list's primary table. */
export const ACCOUNTING_WORKSPACE_READS = {
  dashboard: ["account-move-lines", "account-payments", "payment-transactions", "payment-reversals", "bank-statements", "bank-statement-lines", "tax-deadlines", "budgets"],
  accounts: ["account-groups"],
  "journal-entries": ["account-move-lines"],
  invoices: ["account-move-lines"],
  bills: ["account-move-lines"],
  taxes: [],
  payments: ["account-payments"],
  "payment-operations": ["account-move-lines", "account-payments", "payment-accounts", "payment-transactions", "payment-reconciliations", "payment-reversals", "payment-fees", "bank-statement-import-lines"],
  "tax-groups": [],
  "tax-jurisdictions": ["tax-jurisdictions"],
  "tax-schedules": ["tax-schedules", "tax-jurisdictions"],
  "tax-deadlines": ["tax-deadlines"],
  "payment-terms": [],
  "payment-term-lines": ["account-payment-term-lines"],
  budgets: ["budgets", "budget-lines", "budget-posts"],
  analytic: ["analytic-accounts"],
  "analytic-lines": ["analytic-accounts", "analytic-lines"],
  "analytic-distribution": ["analytic-accounts", "analytic-distribution-models"],
  "bank-statements": ["bank-statements", "bank-statement-lines", "bank-match-candidates", "account-move-lines"],
  "reconciliation-widgets": ["account-reconciliation-widgets"],
  "fixed-assets": ["fixed-assets", "depreciation-lines"],
  "fiscal-years": [],
  "account-periods": [],
  "fx-revaluation": ["fx-revaluation-runs", "account-payments"],
  "credit-control": ["partner-credit-controls"],
  amortization: ["amortization-schedules", "amortization-lines"],
  consolidation: ["consolidation-accounts", "consolidation-journals", "consolidation-elimination-entries"],
  "intercompany-rules": ["intercompany-rules"],
  "intercompany-transactions": ["intercompany-transactions"],
  "account-journals": [],
  "move-lines": ["account-move-lines"],
  "period-close": ["bank-statements", "bank-statement-lines", "financial-reports"],
} as const

export type AccountingWorkspace = keyof typeof ACCOUNTING_WORKSPACE_READS
export const ACCOUNTING_ACTION_WORKSPACES: Readonly<Record<string, AccountingWorkspace>> = {
  createAccount: "accounts", createMove: "journal-entries", createTax: "taxes", createBudget: "budgets",
  createAnalyticAccount: "analytic", createAnalyticLine: "analytic-lines",
  createAnalyticDistributionModel: "analytic-distribution", createReconciliationWidget: "reconciliation-widgets",
  createFiscalYear: "fiscal-years", createAccountPeriod: "account-periods", createAccountPayment: "payments",
  createPaymentTerm: "payment-terms", createPaymentTermLine: "payment-term-lines",
  createAccountJournal: "account-journals", addAccountMoveLine: "move-lines", createCurrencyRate: "fx-revaluation",
  createDepreciationLine: "fixed-assets", createIntercompanyRule: "intercompany-rules",
  createIntercompanyTransaction: "intercompany-transactions",
}
export const ACCOUNTING_IMPORT_WORKSPACES: Readonly<Record<string, AccountingWorkspace>> = {
  account: "accounts", accountMove: "journal-entries", outstandingDocuments: "journal-entries",
  historicalDocumentsForPaymentReplay: "journal-entries", accountMoveLine: "journal-entries",
  tax: "taxes", budget: "budgets", budgetLine: "budgets", analytic: "analytic",
}

export function accountingReadPlan(activeWorkspace: string, retainedWorkspaces: readonly (string | null | undefined)[] = []) {
  const resources = new Set<string>(ACCOUNTING_SHARED_READS)
  for (const workspace of [activeWorkspace, ...retainedWorkspaces]) {
    if (workspace && Object.prototype.hasOwnProperty.call(ACCOUNTING_WORKSPACE_READS, workspace)) {
      for (const resource of ACCOUNTING_WORKSPACE_READS[workspace as AccountingWorkspace]) resources.add(resource)
    }
  }
  return resources
}

const NO_ROWS: never[] = []
/** A disabled React Query can expose cached rows and isLoading:false; it is never a ready dependency. */
export function accountingPlannedCollection<Row>(
  enabled: boolean,
  collection: { state: ModuleDataState; rows: Row[] },
): { state: ModuleDataState; rows: Row[] } {
  return enabled ? collection : { state: { status: "loading" }, rows: NO_ROWS }
}
