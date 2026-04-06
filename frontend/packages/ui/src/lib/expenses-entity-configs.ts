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
      { key: "name", label: t("expenses.expenses.columns.name"), width: "min-w-48" },
      { key: "employeeId", label: t("expenses.expenses.columns.employeeId"), width: "min-w-36" },
      { key: "date", label: t("expenses.expenses.columns.date"), type: "date" },
      { key: "totalAmount", label: t("expenses.expenses.columns.totalAmount"), type: "currency", align: "right" },
      { key: "quantity", label: t("expenses.expenses.columns.quantity"), type: "number", align: "right" },
      { key: "state", label: t("expenses.expenses.columns.state"), type: "badge", ...expenseStateBadges(t) },
    ],
    emptyMessage: t("expenses.expenses.emptyMessage"),
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
      { key: "name", label: t("expenses.expenseReports.columns.name"), width: "min-w-48" },
      { key: "employeeId", label: t("expenses.expenseReports.columns.employeeId"), width: "min-w-36" },
      { key: "totalAmount", label: t("expenses.expenseReports.columns.totalAmount"), type: "currency", align: "right" },
      { key: "state", label: t("expenses.expenseReports.columns.state"), type: "badge", ...sheetStateBadges(t) },
      { key: "accountingDate", label: t("expenses.expenseReports.columns.accountingDate"), type: "date" },
      { key: "createdAt", label: t("expenses.expenseReports.columns.createdAt"), type: "date" },
    ],
    emptyMessage: t("expenses.expenseReports.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const expensesEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "expenses-table": expensesTableConfig(t),
  "expense-sheets-table": expenseSheetsTableConfig(t),
})
