export type AccountingReadinessAction = "invoice" | "bill" | "import" | "journal-import";

export type AccountingTaxReadiness =
  | "ready"
  | "not-required"
  | "missing"
  | "needs-review";

export interface AccountingSetupReadinessInput {
  companyConfigured: boolean;
  baseCurrencyConfigured: boolean;
  fiscalYearConfigured: boolean;
  openPeriodAvailable: boolean;
  salesJournalConfigured: boolean;
  purchaseJournalConfigured: boolean;
  receivableAccountConfigured: boolean;
  payableAccountConfigured: boolean;
  incomeAccountConfigured: boolean;
  expenseAccountConfigured: boolean;
  taxConfiguration: AccountingTaxReadiness;
}

export type AccountingReadinessItemId =
  | "company"
  | "base-currency"
  | "fiscal-year"
  | "open-period"
  | "sales-journal"
  | "purchase-journal"
  | "receivable-account"
  | "payable-account"
  | "income-account"
  | "expense-account"
  | "tax-configuration"
  | "tax-review";

export interface AccountingReadinessItem {
  id: AccountingReadinessItemId;
  severity: "blocking" | "advisory";
  actions: readonly AccountingReadinessAction[];
  label: string;
  reason: string;
  actionLabel: string;
}

export interface AccountingSetupReadinessResult {
  action?: AccountingReadinessAction;
  isReady: boolean;
  items: AccountingReadinessItem[];
  blockingItems: AccountingReadinessItem[];
  advisoryItems: AccountingReadinessItem[];
}

const ALL_ACTIONS = ["invoice", "bill", "import", "journal-import"] as const;
const TAX_ACTIONS = ["invoice", "bill", "import"] as const;
const INVOICE_ACTIONS = ["invoice", "import"] as const;
const BILL_ACTIONS = ["bill", "import"] as const;

function blockingItem(
  id: AccountingReadinessItemId,
  actions: readonly AccountingReadinessAction[],
  label: string,
  reason: string,
  actionLabel: string,
): AccountingReadinessItem {
  return { id, severity: "blocking", actions, label, reason, actionLabel };
}

/**
 * Converts persisted accounting setup state into requirements that can be shown
 * before an invoice, bill, or historical-data import is started.
 */
export function evaluateAccountingSetupReadiness(
  input: AccountingSetupReadinessInput,
  action?: AccountingReadinessAction,
): AccountingSetupReadinessResult {
  const items: AccountingReadinessItem[] = [];

  if (!input.companyConfigured) {
    items.push(
      blockingItem(
        "company",
        ALL_ACTIONS,
        "Company details",
        "Accounting entries need a legal company to own the books.",
        "Configure company",
      ),
    );
  }
  if (!input.baseCurrencyConfigured) {
    items.push(
      blockingItem(
        "base-currency",
        ALL_ACTIONS,
        "Base currency",
        "Amounts cannot be posted until the company base currency is set.",
        "Set base currency",
      ),
    );
  }
  if (!input.fiscalYearConfigured) {
    items.push(
      blockingItem(
        "fiscal-year",
        ALL_ACTIONS,
        "Fiscal year",
        "Transaction dates must belong to a configured fiscal year.",
        "Create fiscal year",
      ),
    );
  }
  if (!input.openPeriodAvailable) {
    items.push(
      blockingItem(
        "open-period",
        ALL_ACTIONS,
        "Open accounting period",
        "There is no open period where accounting entries can be posted.",
        "Open a period",
      ),
    );
  }
  if (!input.salesJournalConfigured) {
    items.push(
      blockingItem(
        "sales-journal",
        INVOICE_ACTIONS,
        "Sales journal",
        "Customer invoices need a journal for their accounting entries.",
        "Create sales journal",
      ),
    );
  }
  if (!input.purchaseJournalConfigured) {
    items.push(
      blockingItem(
        "purchase-journal",
        BILL_ACTIONS,
        "Purchase journal",
        "Vendor bills need a journal for their accounting entries.",
        "Create purchase journal",
      ),
    );
  }
  if (!input.receivableAccountConfigured) {
    items.push(
      blockingItem(
        "receivable-account",
        INVOICE_ACTIONS,
        "Accounts receivable",
        "Customer balances need an account classified as receivable.",
        "Assign receivable account",
      ),
    );
  }
  if (!input.payableAccountConfigured) {
    items.push(
      blockingItem(
        "payable-account",
        BILL_ACTIONS,
        "Accounts payable",
        "Vendor balances need an account classified as payable.",
        "Assign payable account",
      ),
    );
  }
  if (!input.incomeAccountConfigured) {
    items.push(
      blockingItem(
        "income-account",
        INVOICE_ACTIONS,
        "Income account",
        "Invoice lines need an account classified as income.",
        "Assign income account",
      ),
    );
  }
  if (!input.expenseAccountConfigured) {
    items.push(
      blockingItem(
        "expense-account",
        BILL_ACTIONS,
        "Expense account",
        "Bill lines need an account classified as expense.",
        "Assign expense account",
      ),
    );
  }
  if (input.taxConfiguration === "missing") {
    items.push(
      blockingItem(
        "tax-configuration",
        TAX_ACTIONS,
        "Tax configuration",
        "Taxes must be configured or explicitly marked as not required before accounting data is entered.",
        "Configure taxes",
      ),
    );
  } else if (input.taxConfiguration === "needs-review") {
    items.push({
      id: "tax-review",
      severity: "advisory",
      actions: ALL_ACTIONS,
      label: "Tax configuration review",
      reason:
        "Tax setup is available, but it still needs review before statutory reporting.",
      actionLabel: "Review taxes",
    });
  }

  const relevantItems = action
    ? items.filter((item) => item.actions.includes(action))
    : items;
  const blockingItems = relevantItems.filter(
    (item) => item.severity === "blocking",
  );
  const advisoryItems = relevantItems.filter(
    (item) => item.severity === "advisory",
  );

  return {
    action,
    isReady: blockingItems.length === 0,
    items: relevantItems,
    blockingItems,
    advisoryItems,
  };
}
