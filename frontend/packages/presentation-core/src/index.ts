export type TranslationKey = string

export type MetricId = string
export type SeriesId = string
export type TableId = string

export interface MetricDefinition {
  readonly id: MetricId
  readonly labelKey: TranslationKey
  readonly binding: MetricId
}

export interface MetricGroupDefinition {
  readonly kind: "metric-group"
  readonly id: string
  readonly titleKey: TranslationKey
  readonly metrics: readonly MetricDefinition[]
}

export interface TimeSeriesDefinition {
  readonly kind: "time-series"
  readonly id: string
  readonly titleKey: TranslationKey
  readonly series: readonly { readonly id: SeriesId; readonly binding: SeriesId }[]
}

export interface ReportTableDefinition {
  readonly kind: "report-table"
  readonly id: string
  readonly titleKey: TranslationKey
  readonly columns: readonly { readonly id: string; readonly labelKey: TranslationKey }[]
  readonly binding: TableId
}

export type DashboardWidgetDefinition =
  | MetricGroupDefinition
  | TimeSeriesDefinition
  | ReportTableDefinition

export interface DashboardSectionDefinition {
  readonly id: string
  readonly titleKey?: TranslationKey
  readonly widgets: readonly DashboardWidgetDefinition[]
}

export interface DashboardDefinition {
  readonly schemaVersion: 1
  readonly id: string
  readonly titleKey: TranslationKey
  readonly descriptionKey: TranslationKey
  readonly sections: readonly DashboardSectionDefinition[]
}

export interface MetricValue {
  readonly value: number | string
  readonly change?: number
}

export interface SeriesPoint {
  readonly label: string
  readonly value: number
}

export type ReportCell = string | number | boolean | null

export interface ReportRow {
  readonly [column: string]: ReportCell
}

export interface OverviewAttentionRow extends ReportRow {
  readonly reference: string
  readonly amount: string
  readonly status: string
}

export interface DashboardData {
  readonly metrics: Readonly<Record<MetricId, MetricValue>>
  readonly series: Readonly<Record<SeriesId, readonly SeriesPoint[]>>
  readonly tables: Readonly<Record<TableId, readonly ReportRow[]>>
}

export const overviewDashboardDefinition = {
  schemaVersion: 1,
  id: "overview",
  titleKey: "overview.page.title",
  descriptionKey: "overview.page.description",
  sections: [
    {
      id: "overview-kpis",
      widgets: [{
        kind: "metric-group",
        id: "overview-stat-cards",
        titleKey: "overview.dashboard.keyMetrics",
        metrics: [
          { id: "revenue", labelKey: "sales.dashboard.widgets.revenue", binding: "revenue" },
          { id: "open-sales-orders", labelKey: "overview.dashboard.stats.openSalesOrders", binding: "open-sales-orders" },
          { id: "open-tasks", labelKey: "overview.dashboard.stats.openTasks", binding: "open-tasks" },
          { id: "contacts", labelKey: "crm.contacts.title", binding: "contacts" },
        ],
      } satisfies MetricGroupDefinition],
    },
    {
      id: "overview-revenue",
      widgets: [{
        kind: "time-series",
        id: "overview-sales-trend",
        titleKey: "overview.dashboard.widgets.salesTrend",
        series: [{ id: "revenue", binding: "revenue" }],
      } satisfies TimeSeriesDefinition],
    },
    {
      id: "overview-attention",
      titleKey: "overview.dashboard.sections.attention",
      widgets: [{
        kind: "report-table",
        id: "overview-needs-attention",
        titleKey: "overview.dashboard.sections.attention",
        columns: [
          { id: "reference", labelKey: "overview.dashboard.tables.reference" },
          { id: "amount", labelKey: "overview.dashboard.tables.amount" },
          { id: "status", labelKey: "overview.dashboard.tables.status" },
        ],
        binding: "needs-attention",
      } satisfies ReportTableDefinition],
    },
  ],
} as const satisfies DashboardDefinition

export type OverviewDashboardData = DashboardData & {
  readonly metrics: Readonly<Record<"revenue" | "open-sales-orders" | "open-tasks" | "contacts", MetricValue>>
  readonly series: Readonly<Record<"revenue", readonly SeriesPoint[]>>
  readonly tables: Readonly<Record<"needs-attention", readonly OverviewAttentionRow[]>>
}

export type { SavedDraft, SavedDraftSummary, SavedDraftList, SaveDraftRequest } from './generated/saved-draft-contract';
