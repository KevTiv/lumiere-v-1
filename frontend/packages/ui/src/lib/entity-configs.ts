import { i18n as uiI18n } from "@lumiere/i18n"
import { createElement } from "react"
import type { EntityViewConfig } from "./entity-view-types"

// ─── State badge maps (shared across configs) ────────────────────────────────

const moveStateBadges = {
  badgeVariants: { draft: "secondary", posted: "default", cancel: "destructive" },
  badgeLabels: { get draft() { return uiI18n.t("accounting.builtIn.entityConfigs.moveStateBadges.draft.draft") }, get posted() { return uiI18n.t("accounting.builtIn.entityConfigs.moveStateBadges.posted.posted") }, get cancel() { return uiI18n.t("accounting.builtIn.entityConfigs.moveStateBadges.cancelled.cancel") } },
} as const

const paymentStateBadges = {
  badgeVariants: { not_paid: "destructive", partial: "outline", paid: "default", reversed: "secondary" },
  badgeLabels: { get not_paid() { return uiI18n.t("accounting.builtIn.entityConfigs.paymentStateBadges.unpaid.notPaid") }, get partial() { return uiI18n.t("accounting.builtIn.entityConfigs.paymentStateBadges.partial.partial") }, get paid() { return uiI18n.t("accounting.builtIn.entityConfigs.paymentStateBadges.paid.paid") }, get reversed() { return uiI18n.t("accounting.invoices.paymentStates.reversed") } },
} as const

const activeBadges = {
  badgeVariants: { true: "default", false: "secondary" },
  badgeLabels: { get true() { return uiI18n.t("common.active") }, get false() { return uiI18n.t("common.inactive") } },
} as const

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export type AccountsTableConfigOptions = {
  /** Combined code + name for dense lists (optional). */
  formatAccountDisplayName?: (row: Record<string, unknown>) => string
}

export function buildAccountsTableConfig(
  options?: AccountsTableConfigOptions,
): EntityViewConfig {
  const formatName = options?.formatAccountDisplayName

  const nameColumn = {
    key: "name",
    get label() { return uiI18n.t("accounting.builtIn.entityConfigs.nameColumn.name.label") },
    width: "min-w-48",
    ...(formatName
      ? {
          render: (_value: unknown, row: Record<string, unknown>) => {
            const formatted = formatName(row).trim()
            const fallback = String(row.name ?? "").trim()
            const shown = formatted || fallback
            if (!shown)
              return createElement(
                "span",
                { className: "text-muted-foreground" },
                "—",
              )
            return shown
          },
        }
      : {}),
  }

  return {
    id: "accounts-table",
    get title() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.accountsTable.title") },
    get description() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.accountsTable.description") },
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      get searchPlaceholder() { return uiI18n.t("accounting.entities.journals.searchPlaceholder") },
      searchKeys: ["code", "name", "internalGroup"],
      filters: [
        {
          key: "active",
          get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.active.label") },
          type: "select",
          options: [
            { value: "true", get label() { return uiI18n.t("common.active") } },
            { value: "false", get label() { return uiI18n.t("common.inactive") } },
          ],
        },
        {
          key: "internalGroup",
          get label() { return uiI18n.t("accounting.forms.accountGroup.sections.main") },
          type: "select",
          options: [
            { value: "asset", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.internalGroup.label") } },
            { value: "liability", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.internalGroup.labelliability") } },
            { value: "equity", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.internalGroup.labelequity") } },
            { value: "income", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.internalGroup.labelincome") } },
            { value: "expense", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.internalGroup.labelexpense") } },
          ],
        },
      ],
      columns: [
        { key: "code", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.code.label") }, width: "min-w-20" },
        nameColumn,
        { key: "internalGroup", get label() { return uiI18n.t("accounting.forms.accountGroup.sections.main") }, type: "text" },
        {
          key: "openingBalance",
          get label() { return uiI18n.t("accounting.accounts.balance") },
          type: "currency",
          align: "right",
        },
        {
          key: "active",
          get label() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.active.label") },
          type: "badge",
          ...activeBadges,
        },
      ],
      get emptyMessage() { return uiI18n.t("accounting.builtIn.entityConfigs.buildAccountsTableConfig.accountsTable.emptyMessage") },
    },
  }
}

/** Default chart-of-accounts entity config (no custom display formatter). */
export const accountsTableConfig = buildAccountsTableConfig()

export const accountDetailConfig: EntityViewConfig = {
  id: "account-detail",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.accountDetail.title") },
  view: {
    mode: "detail",
    sections: [
      {
        id: "identity",
        get title() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.identity.title") },
        fields: [
          { key: "code", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.code.label") }, width: "1/4" },
          { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.name.label") }, width: "3/4" as "2/3" },
          { key: "internalGroup", get label() { return uiI18n.t("accounting.forms.newAccount.fields.internalGroup") }, width: "1/2" },
          { key: "internalType", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.internalType.label") }, width: "1/2" },
        ],
      },
      {
        id: "balances",
        get title() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.balances.title") },
        fields: [
          { key: "openingDebit", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.openingDebit.label") }, type: "currency", width: "1/3" },
          { key: "openingCredit", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.openingCredit.label") }, type: "currency", width: "1/3" },
          { key: "openingBalance", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.openingBalance.label") }, type: "currency", width: "1/3" },
        ],
      },
      {
        id: "settings",
        get title() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.settings.title") },
        fields: [
          { key: "reconcile", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.reconcile.label") }, type: "boolean", width: "1/4" },
          { key: "isOffBalance", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.isOffBalance.label") }, type: "boolean", width: "1/4" },
          { key: "nonTrade", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.nonTrade.label") }, type: "boolean", width: "1/4" },
          { key: "active", get label() { return uiI18n.t("common.active") }, type: "badge", ...activeBadges, width: "1/4" },
          { key: "note", type: "markdown", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.accountDetailConfig.note.label") }, width: "full" },
        ],
      },
    ],
  },
}

// ─── Journal Entries ─────────────────────────────────────────────────────────

export const journalEntriesTableConfig: EntityViewConfig = {
  id: "journal-entries-table",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.journalEntriesTable.title") },
  get description() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.journalEntriesTable.description") },
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    get searchPlaceholder() { return uiI18n.t("accounting.entities.payments.searchPlaceholder") },
    searchKeys: ["name", "ref", "invoicePartnerDisplayName"],
    filters: [
      {
        key: "state",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.state.label") },
        type: "select",
        options: [
          { value: "draft", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.state.labeldraft") } },
          { value: "posted", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.state.labelposted") } },
          { value: "cancel", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.state.labelcancelled") } },
        ],
      },
      {
        key: "moveType",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.moveType.label") },
        type: "select",
        options: [
          { value: "entry", get label() { return uiI18n.t("accounting.journalEntries.types.entry") } },
          { value: "out_invoice", get label() { return uiI18n.t("accounting.journalEntries.types.outInvoice") } },
          { value: "in_invoice", get label() { return uiI18n.t("accounting.journalEntries.types.inInvoice") } },
          { value: "out_refund", get label() { return uiI18n.t("accounting.journalEntries.types.outRefund") } },
          { value: "in_refund", get label() { return uiI18n.t("accounting.journalEntries.types.inRefund") } },
        ],
      },
    ],
    columns: [
      { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.name.label") }, width: "min-w-32" },
      { key: "date", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.date.label") }, type: "date" },
      { key: "invoicePartnerDisplayName", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.invoicePartnerDisplayName.label") } },
      { key: "amountTotal", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.amountTotal.label") }, type: "currency", align: "right" },
      { key: "amountResidual", get label() { return uiI18n.t("accounting.overview.due") }, type: "currency", align: "right" },
      {
        key: "state",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.state.label") },
        type: "badge",
        ...moveStateBadges,
      },
      {
        key: "paymentState",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.paymentState.label") },
        type: "badge",
        ...paymentStateBadges,
      },
    ],
    get emptyMessage() { return uiI18n.t("accounting.builtIn.entityConfigs.journalEntriesTableConfig.journalEntriesTable.emptyMessage") },
  },
}

export const invoiceDetailConfig: EntityViewConfig = {
  id: "invoice-detail",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.invoiceDetail.title") },
  view: {
    mode: "detail",
    sections: [
      {
        id: "header",
        get title() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.header.title") },
        fields: [
          { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.name.label") }, width: "1/4" },
          { key: "state", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.state.label") }, type: "badge", ...moveStateBadges, width: "1/4" },
          { key: "paymentState", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.paymentState.label") }, type: "badge", ...paymentStateBadges, width: "1/4" },
          { key: "moveType", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.moveType.label") }, width: "1/4" },
          { key: "invoicePartnerDisplayName", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.invoicePartnerDisplayName.label") }, width: "1/2" },
          { key: "ref", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.ref.label") }, width: "1/2" },
        ],
      },
      {
        id: "dates",
        get title() { return uiI18n.t("accounting.invoices.dates") },
        fields: [
          { key: "date", get label() { return uiI18n.t("accounting.forms.newJournalEntry.fields.date") }, type: "date", width: "1/3" },
          { key: "invoiceDate", get label() { return uiI18n.t("accounting.forms.newInvoice.fields.invoiceDate") }, type: "date", width: "1/3" },
          { key: "invoiceDateDue", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.invoiceDateDue.label") }, type: "date", width: "1/3" },
        ],
      },
      {
        id: "amounts",
        get title() { return uiI18n.t("accounting.invoices.amounts") },
        fields: [
          { key: "amountUntaxed", get label() { return uiI18n.t("accounting.forms.newInvoice.summary.subtotal") }, type: "currency", width: "1/4" },
          { key: "amountTax", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.amountTax.label") }, type: "currency", width: "1/4" },
          { key: "amountTotal", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.amountTotal.label") }, type: "currency", width: "1/4" },
          { key: "amountResidual", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.invoiceDetailConfig.amountResidual.label") }, type: "currency", width: "1/4" },
        ],
      },
    ],
  },
}

// ─── Taxes ───────────────────────────────────────────────────────────────────

export const taxesTableConfig: EntityViewConfig = {
  id: "taxes-table",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.taxesTable.title") },
  get description() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.taxesTable.description") },
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    get searchPlaceholder() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.taxesTable.searchPlaceholder") },
    searchKeys: ["name", "description"],
    filters: [
      {
        key: "typeTaxUse",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.typeTaxUse.label") },
        type: "select",
        options: [
          { value: "sale", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.typeTaxUse.labelsales") } },
          { value: "purchase", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.typeTaxUse.labelpurchase") } },
          { value: "none", get label() { return uiI18n.t("common.none") } },
        ],
      },
    ],
    columns: [
      { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.name.label") } },
      { key: "description", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.description.label") } },
      { key: "typeTaxUse", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.typeTaxUse.label") } },
      { key: "amountType", get label() { return uiI18n.t("accounting.forms.newTax.fields.computation") } },
      { key: "amount", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.amount.label") }, type: "percent", align: "right" },
      { key: "priceInclude", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.priceInclude.label") }, type: "boolean", align: "center" },
      {
        key: "active",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.active.label") },
        type: "badge",
        ...activeBadges,
      },
    ],
    get emptyMessage() { return uiI18n.t("accounting.builtIn.entityConfigs.taxesTableConfig.taxesTable.emptyMessage") },
  },
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const budgetsTableConfig: EntityViewConfig = {
  id: "budgets-table",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.budgetsTable.title") },
  get description() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.budgetsTable.description") },
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    get searchPlaceholder() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.budgetsTable.searchPlaceholder") },
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.label") },
        type: "select",
        options: [
          { value: "Draft", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.labeldraft") } },
          { value: "Confirm", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.labelconfirmed") } },
          { value: "Validate", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.labelvalidated") } },
          { value: "Done", get label() { return uiI18n.t("accounting.periodClose.status.done") } },
          { value: "Cancel", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.labelcancelled") } },
        ],
      },
    ],
    columns: [
      { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.name.label") } },
      { key: "dateFrom", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.dateFrom.label") }, type: "date" },
      { key: "dateTo", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.dateTo.label") }, type: "date" },
      { key: "totalPlanned", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.totalPlanned.label") }, type: "currency", align: "right" },
      { key: "totalPractical", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.totalPractical.label") }, type: "currency", align: "right" },
      { key: "totalTheoretical", get label() { return uiI18n.t("accounting.forms.updateBudgetLineActuals.fields.theoreticalAmount") }, type: "currency", align: "right" },
      { key: "variancePercentage", get label() { return uiI18n.t("accounting.budgets.variance") }, type: "percent", align: "right" },
      {
        key: "state",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.label") },
        type: "badge",
        badgeVariants: { Draft: "secondary", Confirm: "outline", Validate: "default", Done: "default", Cancel: "destructive" },
        badgeLabels: { get Draft() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.draft") }, get Confirm() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.confirm") }, get Validate() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.validate") }, get Done() { return uiI18n.t("accounting.periodClose.status.done") }, get Cancel() { return uiI18n.t("accounting.builtIn.entityConfigs.budgetsTableConfig.state.cancel") } },
      },
    ],
    get emptyMessage() { return uiI18n.t("accounting.budgets.workspace.emptyBudgets") },
  },
}

// ─── Analytic Accounts ───────────────────────────────────────────────────────

export const analyticAccountsTableConfig: EntityViewConfig = {
  id: "analytic-accounts-table",
  get title() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.analyticAccountsTable.title") },
  get description() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.analyticAccountsTable.description") },
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    get searchPlaceholder() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.analyticAccountsTable.searchPlaceholder") },
    searchKeys: ["name", "code"],
    columns: [
      { key: "code", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.code.label") }, width: "min-w-20" },
      { key: "name", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.name.label") } },
      { key: "balance", get label() { return uiI18n.t("accounting.accounts.balance") }, type: "currency", align: "right" },
      { key: "debit", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.debit.label") }, type: "currency", align: "right" },
      { key: "credit", get label() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.credit.label") }, type: "currency", align: "right" },
      {
        key: "active",
        get label() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.active.label") },
        type: "badge",
        ...activeBadges,
      },
    ],
    get emptyMessage() { return uiI18n.t("accounting.builtIn.entityConfigs.analyticAccountsTableConfig.analyticAccountsTable.emptyMessage") },
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
