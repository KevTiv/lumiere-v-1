import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const assetStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Open: "default",
    Close: "outline",
  },
  badgeLabels: {
    Draft: t("accounting.entities.fixedAssets.states.Draft"),
    Open: t("accounting.entities.fixedAssets.states.Open"),
    Close: t("accounting.entities.fixedAssets.states.Close"),
  },
}) as const

const bankStatementStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Open: "outline",
    Posted: "default",
    Confirm: "default",
  },
  badgeLabels: {
    Open: t("accounting.entities.bankStatements.states.Open"),
    Posted: t("accounting.entities.bankStatements.states.Posted"),
    Confirm: t("accounting.entities.bankStatements.states.Confirm"),
  },
}) as const

// ── Bank Statements ───────────────────────────────────────────────────────────
export const bankStatementsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "bank-statements-table",
  title: t("accounting.entities.bankStatements.title"),
  description: t("accounting.entities.bankStatements.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.bankStatements.searchPlaceholder"),
    searchKeys: ["name", "reference"],
    filters: [
      {
        key: "state",
        label: t("accounting.entities.bankStatements.filters.state"),
        type: "select",
        options: [
          { value: "Open", label: t("accounting.entities.bankStatements.filters.state.options.Open") },
          { value: "Posted", label: t("accounting.entities.bankStatements.filters.state.options.Posted") },
          { value: "Confirm", label: t("accounting.entities.bankStatements.filters.state.options.Confirm") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.bankStatements.columns.name"), width: "min-w-32" },
      { key: "journalId", label: t("accounting.entities.bankStatements.columns.journalId"), width: "min-w-32" },
      { key: "state", label: t("accounting.entities.bankStatements.columns.state"), type: "badge", ...bankStatementStateBadges(t) },
      { key: "date", label: t("accounting.entities.bankStatements.columns.date"), type: "date" },
      { key: "balanceStart", label: t("accounting.entities.bankStatements.columns.balanceStart"), type: "currency", align: "right" },
      { key: "balanceEndReal", label: t("accounting.entities.bankStatements.columns.balanceEndReal"), type: "currency", align: "right" },
      { key: "lineIds", label: t("accounting.entities.bankStatements.columns.lineIds"), type: "number", align: "right" },
    ],
    emptyMessage: t("accounting.entities.bankStatements.emptyMessage"),
  },
})

// ── Fixed Assets ──────────────────────────────────────────────────────────────
export const fixedAssetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fixed-assets-table",
  title: t("accounting.entities.fixedAssets.title"),
  description: t("accounting.entities.fixedAssets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.fixedAssets.searchPlaceholder"),
    searchKeys: ["name", "codePrefix"],
    filters: [
      {
        key: "state",
        label: t("accounting.entities.fixedAssets.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("accounting.entities.fixedAssets.filters.state.options.Draft") },
          { value: "Open", label: t("accounting.entities.fixedAssets.filters.state.options.Open") },
          { value: "Close", label: t("accounting.entities.fixedAssets.filters.state.options.Close") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.fixedAssets.columns.name"), width: "min-w-48" },
      { key: "state", label: t("accounting.entities.fixedAssets.columns.state"), type: "badge", ...assetStateBadges(t) },
      { key: "acquisitionDate", label: t("accounting.entities.fixedAssets.columns.acquisitionDate"), type: "date" },
      { key: "originalValue", label: t("accounting.entities.fixedAssets.columns.originalValue"), type: "currency", align: "right" },
      { key: "bookValue", label: t("accounting.entities.fixedAssets.columns.bookValue"), type: "currency", align: "right" },
      { key: "depreciatedValue", label: t("accounting.entities.fixedAssets.columns.depreciatedValue"), type: "currency", align: "right" },
      { key: "methodNumberMonth", label: t("accounting.entities.fixedAssets.columns.methodNumberMonth"), type: "number", align: "right" },
    ],
    emptyMessage: t("accounting.entities.fixedAssets.emptyMessage"),
  },
})

// ── Fiscal years ─────────────────────────────────────────────────────────────
const fiscalYearStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Running: "default",
    Closed: "outline",
    Locked: "destructive",
  },
  badgeLabels: {
    Draft: t("accounting.entities.fiscalYears.states.Draft"),
    Running: t("accounting.entities.fiscalYears.states.Running"),
    Closed: t("accounting.entities.fiscalYears.states.Closed"),
    Locked: t("accounting.entities.fiscalYears.states.Locked"),
  },
}) as const

export const fiscalYearsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fiscal-years-table",
  title: t("accounting.entities.fiscalYears.title"),
  description: t("accounting.entities.fiscalYears.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.fiscalYears.searchPlaceholder"),
    searchKeys: ["name", "type", "stateLabel"],
    filters: [
      {
        key: "stateLabel",
        label: t("accounting.entities.fiscalYears.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("accounting.entities.fiscalYears.filters.state.options.Draft") },
          { value: "Running", label: t("accounting.entities.fiscalYears.filters.state.options.Running") },
          { value: "Closed", label: t("accounting.entities.fiscalYears.filters.state.options.Closed") },
          { value: "Locked", label: t("accounting.entities.fiscalYears.filters.state.options.Locked") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.fiscalYears.columns.name"), width: "min-w-36" },
      { key: "dateFrom", label: t("accounting.entities.fiscalYears.columns.dateFrom"), type: "date" },
      { key: "dateTo", label: t("accounting.entities.fiscalYears.columns.dateTo"), type: "date" },
      {
        key: "stateLabel",
        label: t("accounting.entities.fiscalYears.columns.state"),
        type: "badge",
        ...fiscalYearStateBadges(t),
      },
      { key: "type", label: t("accounting.entities.fiscalYears.columns.type"), width: "min-w-24" },
      {
        key: "isAdjustment",
        label: t("accounting.entities.fiscalYears.columns.isAdjustment"),
        type: "boolean",
        align: "center",
      },
    ],
    emptyMessage: t("accounting.entities.fiscalYears.emptyMessage"),
  },
})

// ── Account periods (within fiscal years) ───────────────────────────────────
const accountPeriodStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Open: "default",
    Closed: "outline",
  },
  badgeLabels: {
    Draft: t("accounting.entities.accountPeriods.states.Draft"),
    Open: t("accounting.entities.accountPeriods.states.Open"),
    Closed: t("accounting.entities.accountPeriods.states.Closed"),
  },
}) as const

export const accountPeriodsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "account-periods-table",
  title: t("accounting.entities.accountPeriods.title"),
  description: t("accounting.entities.accountPeriods.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.accountPeriods.searchPlaceholder"),
    searchKeys: ["name", "code", "stateLabel", "fiscalYearLabel"],
    filters: [
      {
        key: "stateLabel",
        label: t("accounting.entities.accountPeriods.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("accounting.entities.accountPeriods.filters.state.options.Draft") },
          { value: "Open", label: t("accounting.entities.accountPeriods.filters.state.options.Open") },
          { value: "Closed", label: t("accounting.entities.accountPeriods.filters.state.options.Closed") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.accountPeriods.columns.name"), width: "min-w-32" },
      { key: "code", label: t("accounting.entities.accountPeriods.columns.code"), width: "min-w-24" },
      {
        key: "fiscalYearLabel",
        label: t("accounting.entities.accountPeriods.columns.fiscalYear"),
        width: "min-w-28",
      },
      { key: "dateFrom", label: t("accounting.entities.accountPeriods.columns.dateFrom"), type: "date" },
      { key: "dateTo", label: t("accounting.entities.accountPeriods.columns.dateTo"), type: "date" },
      {
        key: "stateLabel",
        label: t("accounting.entities.accountPeriods.columns.state"),
        type: "badge",
        ...accountPeriodStateBadges(t),
      },
      {
        key: "isAdjustment",
        label: t("accounting.entities.accountPeriods.columns.isAdjustment"),
        type: "boolean",
        align: "center",
      },
    ],
    emptyMessage: t("accounting.entities.accountPeriods.emptyMessage"),
  },
})

// ── Analytic lines ───────────────────────────────────────────────────────────
export const analyticLinesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "analytic-lines-table",
  title: t("accounting.entities.analyticLines.title"),
  description: t("accounting.entities.analyticLines.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.analyticLines.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("accounting.entities.analyticLines.columns.name"), width: "min-w-40" },
      { key: "accountId", label: t("accounting.entities.analyticLines.columns.accountId"), width: "min-w-28" },
      { key: "amount", label: t("accounting.entities.analyticLines.columns.amount"), type: "currency", align: "right" },
      { key: "date", label: t("accounting.entities.analyticLines.columns.date"), type: "date" },
    ],
    emptyMessage: t("accounting.entities.analyticLines.emptyMessage"),
  },
})

// ── Analytic distribution models ──────────────────────────────────────────────
export const analyticDistributionModelsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "analytic-distribution-models-table",
  title: t("accounting.entities.analyticDistributionModels.title"),
  description: t("accounting.entities.analyticDistributionModels.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.analyticDistributionModels.searchPlaceholder"),
    searchKeys: ["name", "analyticDistribution"],
    columns: [
      { key: "name", label: t("accounting.entities.analyticDistributionModels.columns.name"), width: "min-w-32" },
      {
        key: "isActive",
        label: t("accounting.entities.analyticDistributionModels.columns.isActive"),
        type: "boolean",
      },
      {
        key: "analyticPrecision",
        label: t("accounting.entities.analyticDistributionModels.columns.analyticPrecision"),
        type: "number",
        align: "right",
      },
      {
        key: "analyticDistribution",
        label: t("accounting.entities.analyticDistributionModels.columns.analyticDistribution"),
        width: "min-w-48",
      },
    ],
    emptyMessage: t("accounting.entities.analyticDistributionModels.emptyMessage"),
  },
})

// ── Reconciliation widgets ────────────────────────────────────────────────────
export const reconciliationWidgetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "reconciliation-widgets-table",
  title: t("accounting.entities.reconciliationWidgets.title"),
  description: t("accounting.entities.reconciliationWidgets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.reconciliationWidgets.searchPlaceholder"),
    searchKeys: ["mode", "accountId"],
    columns: [
      {
        key: "accountId",
        label: t("accounting.entities.reconciliationWidgets.columns.accountId"),
        width: "min-w-24",
      },
      {
        key: "mode",
        label: t("accounting.entities.reconciliationWidgets.columns.mode"),
        width: "min-w-28",
      },
      {
        key: "toCheck",
        label: t("accounting.entities.reconciliationWidgets.columns.toCheck"),
        type: "boolean",
      },
      {
        key: "partnerId",
        label: t("accounting.entities.reconciliationWidgets.columns.partnerId"),
        width: "min-w-24",
      },
      {
        key: "moveLineIds",
        label: t("accounting.entities.reconciliationWidgets.columns.moveLineIds"),
        width: "min-w-40",
      },
    ],
    emptyMessage: t("accounting.entities.reconciliationWidgets.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const accountingEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "bank-statements-table": bankStatementsTableConfig(t),
  "fiscal-years-table": fiscalYearsTableConfig(t),
  "account-periods-table": accountPeriodsTableConfig(t),
  "fixed-assets-table": fixedAssetsTableConfig(t),
  "analytic-lines-table": analyticLinesTableConfig(t),
  "analytic-distribution-models-table": analyticDistributionModelsTableConfig(t),
  "reconciliation-widgets-table": reconciliationWidgetsTableConfig(t),
  "intercompany-rules-table": intercompanyRulesTableConfig(t),
  "intercompany-transactions-table": intercompanyTransactionsTableConfig(t),
})

// ── Intercompany Rules ───────────────────────────────────────────────────────
const intercompanyRuleTypeBadges = (t: TFunction) => ({
  badgeVariants: {
    Sale: "default",
    Purchase: "secondary",
    Transfer: "outline",
    Service: "default",
  },
  badgeLabels: {
    Sale: t("accounting.entities.intercompanyRules.states.Sale"),
    Purchase: t("accounting.entities.intercompanyRules.states.Purchase"),
    Transfer: t("accounting.entities.intercompanyRules.states.Transfer"),
    Service: t("accounting.entities.intercompanyRules.states.Service"),
  },
}) as const

export const intercompanyRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "intercompany-rules-table",
  title: t("accounting.entities.intercompanyRules.title"),
  description: t("accounting.entities.intercompanyRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.intercompanyRules.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "ruleType",
        label: t("accounting.entities.intercompanyRules.filters.ruleType"),
        type: "select",
        options: [
          { value: "Sale", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Sale") },
          { value: "Purchase", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Purchase") },
          { value: "Transfer", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Transfer") },
          { value: "Service", label: t("accounting.entities.intercompanyRules.filters.ruleType.options.Service") },
        ],
      },
      {
        key: "isActive",
        label: t("accounting.entities.intercompanyRules.filters.isActive"),
        type: "select",
        options: [
          { value: "true", label: t("accounting.entities.intercompanyRules.filters.isActive.options.true") },
          { value: "false", label: t("accounting.entities.intercompanyRules.filters.isActive.options.false") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("accounting.entities.intercompanyRules.columns.name"), width: "min-w-40" },
      { key: "ruleType", label: t("accounting.entities.intercompanyRules.columns.ruleType"), type: "badge", ...intercompanyRuleTypeBadges(t) },
      { key: "sourceCompanyId", label: t("accounting.entities.intercompanyRules.columns.sourceCompanyId"), width: "min-w-32" },
      { key: "destinationCompanyId", label: t("accounting.entities.intercompanyRules.columns.destinationCompanyId"), width: "min-w-32" },
      { key: "isActive", label: t("accounting.entities.intercompanyRules.columns.isActive"), type: "boolean", align: "center" },
      { key: "autoValidation", label: t("accounting.entities.intercompanyRules.columns.autoValidation"), type: "boolean", align: "center" },
      { key: "autoGenerateInvoice", label: t("accounting.entities.intercompanyRules.columns.autoGenerateInvoice"), type: "boolean", align: "center" },
      { key: "autoGenerateBill", label: t("accounting.entities.intercompanyRules.columns.autoGenerateBill"), type: "boolean", align: "center" },
    ],
    emptyMessage: t("accounting.entities.intercompanyRules.emptyMessage"),
  },
})

// ── Intercompany Transactions ──────────────────────────────────────────────────
const intercompanyTransactionStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Pending: "outline",
    Approved: "default",
    Processing: "default",
    Completed: "default",
    Error: "destructive",
    Cancelled: "outline",
  },
  badgeLabels: {
    Draft: t("accounting.entities.intercompanyTransactions.states.Draft"),
    Pending: t("accounting.entities.intercompanyTransactions.states.Pending"),
    Approved: t("accounting.entities.intercompanyTransactions.states.Approved"),
    Processing: t("accounting.entities.intercompanyTransactions.states.Processing"),
    Completed: t("accounting.entities.intercompanyTransactions.states.Completed"),
    Error: t("accounting.entities.intercompanyTransactions.states.Error"),
    Cancelled: t("accounting.entities.intercompanyTransactions.states.Cancelled"),
  },
}) as const

const intercompanyTransactionTypeBadges = (t: TFunction) => ({
  badgeVariants: {
    Sale: "default",
    Purchase: "secondary",
    Transfer: "outline",
    Service: "default",
  },
  badgeLabels: {
    Sale: t("accounting.entities.intercompanyTransactions.states.Sale"),
    Purchase: t("accounting.entities.intercompanyTransactions.states.Purchase"),
    Transfer: t("accounting.entities.intercompanyTransactions.states.Transfer"),
    Service: t("accounting.entities.intercompanyTransactions.states.Service"),
  },
}) as const

export const intercompanyTransactionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "intercompany-transactions-table",
  title: t("accounting.entities.intercompanyTransactions.title"),
  description: t("accounting.entities.intercompanyTransactions.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("accounting.entities.intercompanyTransactions.searchPlaceholder"),
    searchKeys: ["originDocumentId", "originDocumentModel"],
    filters: [
      {
        key: "state",
        label: t("accounting.entities.intercompanyTransactions.filters.state"),
        type: "select",
        options: [
          { value: "Draft", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Draft") },
          { value: "Pending", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Pending") },
          { value: "Approved", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Approved") },
          { value: "Processing", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Processing") },
          { value: "Completed", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Completed") },
          { value: "Error", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Error") },
          { value: "Cancelled", label: t("accounting.entities.intercompanyTransactions.filters.state.options.Cancelled") },
        ],
      },
      {
        key: "transactionType",
        label: t("accounting.entities.intercompanyTransactions.filters.transactionType"),
        type: "select",
        options: [
          { value: "Sale", label: t("accounting.entities.intercompanyTransactions.filters.transactionType.options.Sale") },
          { value: "Purchase", label: t("accounting.entities.intercompanyTransactions.filters.transactionType.options.Purchase") },
          { value: "Transfer", label: t("accounting.entities.intercompanyTransactions.filters.transactionType.options.Transfer") },
          { value: "Service", label: t("accounting.entities.intercompanyTransactions.filters.transactionType.options.Service") },
        ],
      },
    ],
    columns: [
      { key: "originDocumentId", label: t("accounting.entities.intercompanyTransactions.columns.originDocumentId"), width: "min-w-28" },
      { key: "originDocumentModel", label: t("accounting.entities.intercompanyTransactions.columns.originDocumentModel"), width: "min-w-32" },
      { key: "destinationCompanyId", label: t("accounting.entities.intercompanyTransactions.columns.destinationCompanyId"), width: "min-w-32" },
      { key: "amount", label: t("accounting.entities.intercompanyTransactions.columns.amount"), type: "currency", align: "right" },
      { key: "currencyId", label: t("accounting.entities.intercompanyTransactions.columns.currencyId"), width: "min-w-24" },
      { key: "transactionType", label: t("accounting.entities.intercompanyTransactions.columns.transactionType"), type: "badge", ...intercompanyTransactionTypeBadges(t) },
      { key: "state", label: t("accounting.entities.intercompanyTransactions.columns.state"), type: "badge", ...intercompanyTransactionStateBadges(t) },
      { key: "autoProcess", label: t("accounting.entities.intercompanyTransactions.columns.autoProcess"), type: "boolean", align: "center" },
      { key: "requiresApproval", label: t("accounting.entities.intercompanyTransactions.columns.requiresApproval"), type: "boolean", align: "center" },
    ],
    emptyMessage: t("accounting.entities.intercompanyTransactions.emptyMessage"),
  },
})
