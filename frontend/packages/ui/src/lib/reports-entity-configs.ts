import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

const reportStateBadges = (t: TFunction) => ({
  badgeVariants: { draft: "secondary", generated: "default", exported: "outline", archived: "destructive" },
  badgeLabels: {
    draft: t("reports.financialReports.states.draft"),
    generated: t("reports.financialReports.states.generated"),
    exported: t("reports.financialReports.states.exported"),
    archived: t("reports.financialReports.states.archived"),
  },
}) as const

// ── Financial Reports ─────────────────────────────────────────────────────────
export const financialReportsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "financial-reports-table",
  title: t("reports.financialReports.title"),
  description: t("reports.financialReports.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.financialReports.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("reports.financialReports.filters.state"),
        type: "select",
        options: [
          { value: "draft", label: t("reports.financialReports.filters.state.options.draft") },
          { value: "generated", label: t("reports.financialReports.filters.state.options.generated") },
          { value: "exported", label: t("reports.financialReports.filters.state.options.exported") },
          { value: "archived", label: t("reports.financialReports.filters.state.options.archived") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("reports.financialReports.columns.name"), width: "min-w-48" },
      { key: "dateFrom", label: t("reports.financialReports.columns.dateFrom"), type: "date" },
      { key: "dateTo", label: t("reports.financialReports.columns.dateTo"), type: "date" },
      { key: "state", label: t("reports.financialReports.columns.state"), type: "badge", ...reportStateBadges(t) },
      { key: "showZeroLines", label: t("reports.financialReports.columns.showZeroLines"), type: "boolean" },
      { key: "generatedAt", label: t("reports.financialReports.columns.generatedAt"), type: "date" },
    ],
    emptyMessage: t("reports.financialReports.emptyMessage"),
  },
})

// ── Trial Balances ────────────────────────────────────────────────────────────
export const trialBalancesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "trial-balances-table",
  title: t("reports.trialBalance.title"),
  description: t("reports.trialBalance.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.trialBalance.searchPlaceholder"),
    searchKeys: ["accountCode", "accountName"],
    columns: [
      { key: "accountCode", label: t("reports.trialBalance.columns.accountCode"), width: "min-w-20" },
      { key: "accountName", label: t("reports.trialBalance.columns.accountName"), width: "min-w-48" },
      { key: "openingDebit", label: t("reports.trialBalance.columns.openingDebit"), type: "currency", align: "right" },
      { key: "openingCredit", label: t("reports.trialBalance.columns.openingCredit"), type: "currency", align: "right" },
      { key: "periodDebit", label: t("reports.trialBalance.columns.periodDebit"), type: "currency", align: "right" },
      { key: "periodCredit", label: t("reports.trialBalance.columns.periodCredit"), type: "currency", align: "right" },
      { key: "closingDebit", label: t("reports.trialBalance.columns.closingDebit"), type: "currency", align: "right" },
      { key: "closingCredit", label: t("reports.trialBalance.columns.closingCredit"), type: "currency", align: "right" },
    ],
    emptyMessage: t("reports.trialBalance.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const reportsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "financial-reports-table": financialReportsTableConfig(t),
  "trial-balances-table": trialBalancesTableConfig(t),
})
