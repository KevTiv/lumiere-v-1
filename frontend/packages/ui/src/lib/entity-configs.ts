import type { EntityViewConfig } from "./entity-view-types"

// ─── State badge maps (shared across configs) ────────────────────────────────

const moveStateBadges = {
  badgeVariants: { draft: "secondary", posted: "default", cancel: "destructive" },
  badgeLabels: { draft: "Draft", posted: "Posted", cancel: "Cancelled" },
} as const

const paymentStateBadges = {
  badgeVariants: { not_paid: "destructive", partial: "outline", paid: "default", reversed: "secondary" },
  badgeLabels: { not_paid: "Unpaid", partial: "Partial", paid: "Paid", reversed: "Reversed" },
} as const

const activeBadges = {
  badgeVariants: { true: "default", false: "secondary" },
  badgeLabels: { true: "Active", false: "Inactive" },
} as const

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export const accountsTableConfig: EntityViewConfig = {
  id: "accounts-table",
  title: "Chart of Accounts",
  description: "All general ledger accounts",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by code or name…",
    searchKeys: ["code", "name"],
    filters: [
      {
        key: "active",
        label: "Status",
        type: "select",
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
      {
        key: "internalGroup",
        label: "Group",
        type: "select",
        options: [
          { value: "asset", label: "Asset" },
          { value: "liability", label: "Liability" },
          { value: "equity", label: "Equity" },
          { value: "income", label: "Income" },
          { value: "expense", label: "Expense" },
        ],
      },
    ],
    columns: [
      { key: "code", label: "Code", width: "min-w-20" },
      { key: "name", label: "Name", width: "min-w-48" },
      { key: "internalGroup", label: "Group", type: "text" },
      { key: "openingBalance", label: "Balance", type: "currency", align: "right" },
      {
        key: "active",
        label: "Status",
        type: "badge",
        ...activeBadges,
      },
    ],
    emptyMessage: "No accounts found.",
  },
}

export const accountDetailConfig: EntityViewConfig = {
  id: "account-detail",
  title: "Account Details",
  view: {
    mode: "detail",
    sections: [
      {
        id: "identity",
        title: "Identity",
        fields: [
          { key: "code", label: "Account Code", width: "1/4" },
          { key: "name", label: "Account Name", width: "3/4" as "2/3" },
          { key: "internalGroup", label: "Internal Group", width: "1/2" },
          { key: "internalType", label: "Internal Type", width: "1/2" },
        ],
      },
      {
        id: "balances",
        title: "Balances",
        fields: [
          { key: "openingDebit", label: "Opening Debit", type: "currency", width: "1/3" },
          { key: "openingCredit", label: "Opening Credit", type: "currency", width: "1/3" },
          { key: "openingBalance", label: "Net Balance", type: "currency", width: "1/3" },
        ],
      },
      {
        id: "settings",
        title: "Settings",
        fields: [
          { key: "reconcile", label: "Reconcilable", type: "boolean", width: "1/4" },
          { key: "isOffBalance", label: "Off-Balance", type: "boolean", width: "1/4" },
          { key: "nonTrade", label: "Non-Trade", type: "boolean", width: "1/4" },
          { key: "active", label: "Active", type: "badge", ...activeBadges, width: "1/4" },
          { key: "note", label: "Notes", width: "full" },
        ],
      },
    ],
  },
}

// ─── Journal Entries ─────────────────────────────────────────────────────────

export const journalEntriesTableConfig: EntityViewConfig = {
  id: "journal-entries-table",
  title: "Journal Entries",
  description: "All accounting moves",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by reference or partner…",
    searchKeys: ["name", "ref", "invoicePartnerDisplayName"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "posted", label: "Posted" },
          { value: "cancel", label: "Cancelled" },
        ],
      },
      {
        key: "moveType",
        label: "Type",
        type: "select",
        options: [
          { value: "entry", label: "Journal Entry" },
          { value: "out_invoice", label: "Customer Invoice" },
          { value: "in_invoice", label: "Vendor Bill" },
          { value: "out_refund", label: "Credit Note" },
          { value: "in_refund", label: "Vendor Credit" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-32" },
      { key: "date", label: "Date", type: "date" },
      { key: "invoicePartnerDisplayName", label: "Partner" },
      { key: "amountTotal", label: "Total", type: "currency", align: "right" },
      { key: "amountResidual", label: "Due", type: "currency", align: "right" },
      {
        key: "state",
        label: "Status",
        type: "badge",
        ...moveStateBadges,
      },
      {
        key: "paymentState",
        label: "Payment",
        type: "badge",
        ...paymentStateBadges,
      },
    ],
    emptyMessage: "No journal entries found.",
  },
}

export const invoiceDetailConfig: EntityViewConfig = {
  id: "invoice-detail",
  title: "Invoice",
  view: {
    mode: "detail",
    sections: [
      {
        id: "header",
        title: "Invoice Header",
        fields: [
          { key: "name", label: "Number", width: "1/4" },
          { key: "state", label: "Status", type: "badge", ...moveStateBadges, width: "1/4" },
          { key: "paymentState", label: "Payment", type: "badge", ...paymentStateBadges, width: "1/4" },
          { key: "moveType", label: "Type", width: "1/4" },
          { key: "invoicePartnerDisplayName", label: "Partner", width: "1/2" },
          { key: "ref", label: "Reference", width: "1/2" },
        ],
      },
      {
        id: "dates",
        title: "Dates",
        fields: [
          { key: "date", label: "Accounting Date", type: "date", width: "1/3" },
          { key: "invoiceDate", label: "Invoice Date", type: "date", width: "1/3" },
          { key: "invoiceDateDue", label: "Due Date", type: "date", width: "1/3" },
        ],
      },
      {
        id: "amounts",
        title: "Amounts",
        fields: [
          { key: "amountUntaxed", label: "Subtotal", type: "currency", width: "1/4" },
          { key: "amountTax", label: "Tax", type: "currency", width: "1/4" },
          { key: "amountTotal", label: "Total", type: "currency", width: "1/4" },
          { key: "amountResidual", label: "Amount Due", type: "currency", width: "1/4" },
        ],
      },
    ],
  },
}

// ─── Taxes ───────────────────────────────────────────────────────────────────

export const taxesTableConfig: EntityViewConfig = {
  id: "taxes-table",
  title: "Taxes",
  description: "Configured tax rates",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search taxes…",
    searchKeys: ["name", "description"],
    filters: [
      {
        key: "typeTaxUse",
        label: "Usage",
        type: "select",
        options: [
          { value: "sale", label: "Sales" },
          { value: "purchase", label: "Purchase" },
          { value: "none", label: "None" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "description", label: "Label" },
      { key: "typeTaxUse", label: "Usage" },
      { key: "amountType", label: "Computation" },
      { key: "amount", label: "Rate", type: "percent", align: "right" },
      { key: "priceInclude", label: "Price Incl.", type: "boolean", align: "center" },
      {
        key: "active",
        label: "Status",
        type: "badge",
        ...activeBadges,
      },
    ],
    emptyMessage: "No taxes found.",
  },
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const budgetsTableConfig: EntityViewConfig = {
  id: "budgets-table",
  title: "Budgets",
  description: "Budget overview with actuals vs planned",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search budgets…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "confirm", label: "Confirmed" },
          { value: "validate", label: "Validated" },
          { value: "done", label: "Done" },
          { value: "cancel", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
      { key: "totalPlanned", label: "Planned", type: "currency", align: "right" },
      { key: "totalPractical", label: "Actual", type: "currency", align: "right" },
      { key: "totalTheoretical", label: "Theoretical", type: "currency", align: "right" },
      { key: "variancePercentage", label: "Variance %", type: "percent", align: "right" },
      {
        key: "state",
        label: "Status",
        type: "badge",
        badgeVariants: { draft: "secondary", confirm: "outline", validate: "default", done: "default", cancel: "destructive" },
        badgeLabels: { draft: "Draft", confirm: "Confirmed", validate: "Validated", done: "Done", cancel: "Cancelled" },
      },
    ],
    emptyMessage: "No budgets found.",
  },
}

// ─── Analytic Accounts ───────────────────────────────────────────────────────

export const analyticAccountsTableConfig: EntityViewConfig = {
  id: "analytic-accounts-table",
  title: "Analytic Accounts",
  description: "Cost centers and analytic dimensions",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search analytic accounts…",
    searchKeys: ["name", "code"],
    columns: [
      { key: "code", label: "Code", width: "min-w-20" },
      { key: "name", label: "Name" },
      { key: "balance", label: "Balance", type: "currency", align: "right" },
      { key: "debit", label: "Debit", type: "currency", align: "right" },
      { key: "credit", label: "Credit", type: "currency", align: "right" },
      {
        key: "active",
        label: "Status",
        type: "badge",
        ...activeBadges,
      },
    ],
    emptyMessage: "No analytic accounts found.",
  },
}

// ─── Config registry (mirrors formConfigs pattern) ───────────────────────────

export const entityViewConfigs: Record<string, EntityViewConfig> = {
  "accounts-table": accountsTableConfig,
  "account-detail": accountDetailConfig,
  "journal-entries-table": journalEntriesTableConfig,
  "invoice-detail": invoiceDetailConfig,
  "taxes-table": taxesTableConfig,
  "budgets-table": budgetsTableConfig,
  "analytic-accounts-table": analyticAccountsTableConfig,
}
