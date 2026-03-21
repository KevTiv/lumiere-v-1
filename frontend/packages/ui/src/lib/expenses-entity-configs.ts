import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const expenseStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", reported: "outline", approved: "default", done: "default", refused: "destructive" },
  badgeLabels: {
    draft: t("expenses.expenses.states.draft"),
    reported: t("expenses.expenses.states.reported"),
    approved: t("expenses.expenses.states.approved"),
    done: t("expenses.expenses.states.done"),
    refused: t("expenses.expenses.states.refused"),
  },
}) as const

const sheetStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", submit: "outline", approve: "default", post: "default", done: "default" },
  badgeLabels: {
    draft: t("expenses.expenseReports.states.draft"),
    submit: t("expenses.expenseReports.states.submit"),
    approve: t("expenses.expenseReports.states.approve"),
    post: t("expenses.expenseReports.states.post"),
    done: t("expenses.expenseReports.states.done"),
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
        label: t("expenses.expenses.filters.state"),
        type: "select",
        options: [
          { value: "draft", label: t("expenses.expenses.filters.state.options.draft") },
          { value: "reported", label: t("expenses.expenses.filters.state.options.reported") },
          { value: "approved", label: t("expenses.expenses.filters.state.options.approved") },
          { value: "done", label: t("expenses.expenses.filters.state.options.done") },
          { value: "refused", label: t("expenses.expenses.filters.state.options.refused") },
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
        label: t("expenses.expenseReports.filters.state"),
        type: "select",
        options: [
          { value: "draft", label: t("expenses.expenseReports.filters.state.options.draft") },
          { value: "submit", label: t("expenses.expenseReports.filters.state.options.submit") },
          { value: "approve", label: t("expenses.expenseReports.filters.state.options.approve") },
          { value: "post", label: t("expenses.expenseReports.filters.state.options.post") },
          { value: "done", label: t("expenses.expenseReports.filters.state.options.done") },
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
