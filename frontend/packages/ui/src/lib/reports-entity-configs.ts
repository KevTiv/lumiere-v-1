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
        label: t("reports.financialReports.filters.state.label"),
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

// ── EU VAT reports ─────────────────────────────────────────────────────────────
export const vatReportsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "vat-reports-table",
  title: t("reports.vat.title"),
  description: t("reports.vat.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.vat.searchPlaceholder"),
    searchKeys: ["name"],
    rowSelectionToggleOnClick: true,
    columns: [
      { key: "name", label: t("reports.vat.columns.name"), width: "min-w-48" },
      {
        key: "state",
        label: t("reports.vat.columns.state"),
        type: "badge",
        ...reportStateBadges(t),
      },
      {
        key: "box01TaxableSupplies",
        label: t("reports.vat.columns.box01"),
        type: "currency",
        align: "right",
      },
      {
        key: "box02VatDue",
        label: t("reports.vat.columns.box02"),
        type: "currency",
        align: "right",
      },
      {
        key: "netVat",
        label: t("reports.vat.columns.netVat"),
        type: "currency",
        align: "right",
      },
    ],
    emptyMessage: t("reports.vat.empty"),
  },
})

// ── Report templates ─────────────────────────────────────────────────────────────
export const reportTemplatesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "report-templates-table",
  title: t("reports.reportTemplates.title"),
  description: t("reports.reportTemplates.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.reportTemplates.searchPlaceholder"),
    searchKeys: ["name", "model"],
    columns: [
      { key: "name", label: t("reports.reportTemplates.columns.name"), width: "min-w-40" },
      { key: "model", label: t("reports.reportTemplates.columns.model") },
      { key: "reportType", label: t("reports.reportTemplates.columns.reportType") },
      { key: "orientation", label: t("reports.reportTemplates.columns.orientation") },
      { key: "isActive", label: t("reports.reportTemplates.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("reports.reportTemplates.emptyMessage"),
  },
})

// ── Scheduled reports ───────────────────────────────────────────────────────────
export const scheduledReportsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "scheduled-reports-table",
  title: t("reports.scheduledReports.title"),
  description: t("reports.scheduledReports.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.scheduledReports.searchPlaceholder"),
    searchKeys: ["name"],
    columns: [
      { key: "name", label: t("reports.scheduledReports.columns.name"), width: "min-w-40" },
      { key: "reportTemplateId", label: t("reports.scheduledReports.columns.templateId") },
      { key: "frequency", label: t("reports.scheduledReports.columns.frequency") },
      { key: "nextRun", label: t("reports.scheduledReports.columns.nextRun"), type: "datetime" },
      { key: "runCount", label: t("reports.scheduledReports.columns.runCount"), type: "number" },
      { key: "isActive", label: t("reports.scheduledReports.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("reports.scheduledReports.emptyMessage"),
  },
})

// ── Analytics metrics ───────────────────────────────────────────────────────────
export const analyticsMetricsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "analytics-metrics-table",
  title: t("reports.analyticsMetrics.title"),
  description: t("reports.analyticsMetrics.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.analyticsMetrics.searchPlaceholder"),
    searchKeys: ["name", "category"],
    columns: [
      { key: "name", label: t("reports.analyticsMetrics.columns.name"), width: "min-w-40" },
      { key: "category", label: t("reports.analyticsMetrics.columns.category") },
      { key: "metricType", label: t("reports.analyticsMetrics.columns.metricType") },
      { key: "model", label: t("reports.analyticsMetrics.columns.model") },
      { key: "aggregation", label: t("reports.analyticsMetrics.columns.aggregation") },
      { key: "currentValue", label: t("reports.analyticsMetrics.columns.currentValue"), type: "number" },
      { key: "isActive", label: t("reports.analyticsMetrics.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("reports.analyticsMetrics.emptyMessage"),
  },
})

export const dashboardsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "dashboards-table",
  title: t("reports.dashboards.title"),
  description: t("reports.dashboards.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.dashboards.searchPlaceholder"),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("reports.dashboards.columns.name"), width: "min-w-48" },
      { key: "description", label: t("reports.dashboards.columns.description"), width: "min-w-48" },
      { key: "isDefault", label: t("reports.dashboards.columns.isDefault"), type: "boolean" },
      { key: "isShared", label: t("reports.dashboards.columns.isShared"), type: "boolean" },
      { key: "createDate", label: t("reports.dashboards.columns.createDate"), type: "date" },
    ],
    emptyMessage: t("reports.dashboards.emptyMessage"),
  },
})

export const dashboardWidgetsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "dashboard-widgets-table",
  title: t("reports.dashboardWidgets.title"),
  description: t("reports.dashboardWidgets.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("reports.dashboardWidgets.searchPlaceholder"),
    searchKeys: ["name", "model"],
    columns: [
      { key: "name", label: t("reports.dashboardWidgets.columns.name"), width: "min-w-40" },
      { key: "model", label: t("reports.dashboardWidgets.columns.model"), width: "min-w-36" },
      { key: "width", label: t("reports.dashboardWidgets.columns.width"), type: "number", align: "right" },
      { key: "height", label: t("reports.dashboardWidgets.columns.height"), type: "number", align: "right" },
      { key: "isActive", label: t("reports.dashboardWidgets.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("reports.dashboardWidgets.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const reportsEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "financial-reports-table": financialReportsTableConfig(t),
  "trial-balances-table": trialBalancesTableConfig(t),
  "report-templates-table": reportTemplatesTableConfig(t),
  "scheduled-reports-table": scheduledReportsTableConfig(t),
  "analytics-metrics-table": analyticsMetricsTableConfig(t),
  "dashboards-table": dashboardsTableConfig(t),
  "dashboard-widgets-table": dashboardWidgetsTableConfig(t),
})
