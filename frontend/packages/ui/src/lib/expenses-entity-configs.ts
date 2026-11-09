import { entityColumnLayouts as layout } from "./entity-column-layouts"
import { recordCurrencyColumn } from "./record-currency-column"
import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const expenseStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Submitted: "outline",
    Approved: "default",
    Posted: "default",
    Done: "default",
    Refused: "destructive",
  },
  badgeLabels: {
    Draft: t("expenses.expenses.states.Draft"),
    Submitted: t("expenses.expenses.states.Submitted"),
    Approved: t("expenses.expenses.states.Approved"),
    Posted: t("expenses.expenses.states.Posted"),
    Done: t("expenses.expenses.states.Done"),
    Refused: t("expenses.expenses.states.Refused"),
  },
}) as const

const sheetStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Submitted: "outline",
    Approved: "default",
    Posted: "default",
    Done: "default",
    Refused: "destructive",
  },
  badgeLabels: {
    Draft: t("expenses.expenseReports.states.Draft"),
    Submitted: t("expenses.expenseReports.states.Submitted"),
    Approved: t("expenses.expenseReports.states.Approved"),
    Posted: t("expenses.expenseReports.states.Posted"),
    Done: t("expenses.expenseReports.states.Done"),
    Refused: t("expenses.expenseReports.states.Refused"),
  },
}) as const

// ── Expenses ──────────────────────────────────────────────────────────────────
export const expensesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "expenses-table",
  title: t("expenses.expenses.title"),
  description: t("expenses.expenses.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("expenses.expenses.searchPlaceholder"),
    searchKeys: ["name", "description"],
    filters: [
      {
        key: "state",
        label: t("expenses.expenses.filters.state.label"),
        type: "select",
        options: [
          { value: "Draft", label: t("expenses.expenses.filters.state.options.Draft") },
          { value: "Submitted", label: t("expenses.expenses.filters.state.options.Submitted") },
          { value: "Approved", label: t("expenses.expenses.filters.state.options.Approved") },
          { value: "Posted", label: t("expenses.expenses.filters.state.options.Posted") },
          { value: "Done", label: t("expenses.expenses.filters.state.options.Done") },
          { value: "Refused", label: t("expenses.expenses.filters.state.options.Refused") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("expenses.expenses.columns.name"), layout: layout.identity },
      { key: "employeeName", label: t("expenses.expenses.columns.employeeId"), layout: layout.location },
      { key: "date", label: t("expenses.expenses.columns.date"), type: "date", layout: layout.date },
      recordCurrencyColumn("totalAmount", t("expenses.expenses.columns.totalAmount")),
      { key: "quantity", label: t("expenses.expenses.columns.quantity"), type: "number", align: "right", layout: layout.quantity },
      { key: "state", label: t("expenses.expenses.columns.state"), type: "badge", layout: layout.status, ...expenseStateBadges(t) },
    ],
    emptyMessage: t("expenses.expenses.emptyMessage"),
    emptyState: {
      title: t("expenses.expenses.emptyMessage"),
      description: t("expenses.expenses.emptyState.description", { defaultValue: "Expenses record what employees spend so it can be approved, reimbursed and booked to the right accounts." }),
      permission: { resource: "hr_expense", action: "create" },
      secondaryActionId: "csv-expenses",
      learnHint: t("expenses.expenses.emptyState.hint", { defaultValue: "Group expenses into a report to submit them for approval." }),
    },
  },
})

// ── Expense Sheets ────────────────────────────────────────────────────────────
export const expenseSheetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "expense-sheets-table",
  title: t("expenses.expenseReports.title"),
  description: t("expenses.expenseReports.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("expenses.expenseReports.searchPlaceholder"),
    searchKeys: ["name", "notes"],
    filters: [
      {
        key: "state",
        label: t("expenses.expenseReports.filters.state.label"),
        type: "select",
        options: [
          { value: "Draft", label: t("expenses.expenseReports.filters.state.options.Draft") },
          { value: "Submitted", label: t("expenses.expenseReports.filters.state.options.Submitted") },
          { value: "Approved", label: t("expenses.expenseReports.filters.state.options.Approved") },
          { value: "Posted", label: t("expenses.expenseReports.filters.state.options.Posted") },
          { value: "Done", label: t("expenses.expenseReports.filters.state.options.Done") },
          { value: "Refused", label: t("expenses.expenseReports.filters.state.options.Refused") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("expenses.expenseReports.columns.name"), layout: layout.identity },
      { key: "employeeName", label: t("expenses.expenseReports.columns.employeeId"), layout: layout.location },
      recordCurrencyColumn("totalAmount", t("expenses.expenseReports.columns.totalAmount")),
      { key: "state", label: t("expenses.expenseReports.columns.state"), type: "badge", layout: layout.status, ...sheetStateBadges(t) },
      { key: "accountingDate", label: t("expenses.expenseReports.columns.accountingDate"), type: "date", layout: layout.date },
      { key: "createdAt", label: t("expenses.expenseReports.columns.createdAt"), type: "date", layout: layout.date },
    ],
    emptyMessage: t("expenses.expenseReports.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const expensesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "expenses-table": expensesTableConfig(t),
  "expense-sheets-table": expenseSheetsTableConfig(t),
})
