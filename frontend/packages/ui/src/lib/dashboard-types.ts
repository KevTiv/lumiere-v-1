import type { ReactNode } from "react"
import type { ChartDatum, ChartSeriesSpec, ChartValueFormat } from "./chart-format"
import type { RankedBarItem } from "../charts/ranked-bar-list"
import type { ShareBarRow } from "../charts/segmented-share-bar"
import type { RadialGaugeStat, RadialGaugeTone } from "../charts/radial-gauge"
import type { EntityColumn, EntityRow } from "./entity-view-types"

export type GridWidth = "full" | "2/3" | "1/2" | "1/3"

export type WidgetType =
  | "kpi"
  | "diagnostic"
  | "area-chart"
  | "line-chart"
  | "bar-chart"
  | "donut-chart"
  | "funnel-chart"
  | "metrics"
  | "table"
  | "stat-cards"
  | "custom"
  | "overdue-invoices"
  | "cash-flow"
  | "budget-progress"
  | "tax-deadline"
  | "account-balance"
  | "ios-tiles"
  | "activity-rings"
  | "countdown"
  | "quick-actions"
  | "combo-chart"
  | "step-chart"
  | "ranked-bars"
  | "share-bar"
  | "radial-gauge"
  | "tabbed-table"

export interface BaseWidget {
  id: string
  type: WidgetType
  title: string
  width: GridWidth
  useCard?: boolean
}

export interface KPIWidget extends BaseWidget {
  type: "kpi"
  data: {
    value: string | number
    label: string
    change?: number
    changeLabel?: string
    trend?: "up" | "down" | "neutral"
    icon?: string
  }
}

export interface DiagnosticWidget extends BaseWidget {
  type: "diagnostic"
  data: {
    code:
      | "invalid-binding"
      | "invalid-filter"
      | "invalid-operator"
      | "invalid-aggregation"
      | "invalid-sort"
      | "invalid-chart-type"
      | "invalid-widget-type"
      | "missing-model"
      | "missing-group-by"
      | "missing-time-field"
      | "invalid-timestamp"
      | "missing-measure"
    message: string
    rejectedRows?: number
  }
}

export interface AreaChartWidget extends BaseWidget {
  type: "area-chart"
  data: {
    series: { name: string; label?: string; color: string }[]
    values: Array<{ [key: string]: string | number }>
    xAxisKey: string
    /** False for counts; omitted for continuous monetary measures. */
    allowDecimals?: boolean
  }
}

export interface LineChartWidget extends BaseWidget {
  type: "line-chart"
  data: {
    series: { name: string; label?: string; color: string }[]
    values: Array<{ [key: string]: string | number }>
    xAxisKey: string
  }
}

export interface BarChartWidget extends BaseWidget {
  type: "bar-chart"
  data: {
    series: { name: string; label?: string; color: string }[]
    values: Array<{ [key: string]: string | number }>
    categoryKey: string
    /** False for counts; omitted for continuous monetary measures. */
    allowDecimals?: boolean
    layout?: "horizontal" | "vertical"
    stacked?: boolean
    onSegmentClick?: (name: string) => void
    onCategoryClick?: (category: string) => void
  }
}

export interface DonutChartWidget extends BaseWidget {
  type: "donut-chart"
  data: {
    segments: Array<{ name: string; value: number; color?: string }>
    /** Pixels or percentage string (e.g. "62%"). Defaults to "62%". */
    innerRadius?: number | string
    /** Small caption rendered under the total in the donut hole. */
    centerLabel?: string
    /** Message shown when there are no segments. Defaults to "No data". */
    emptyLabel?: string
    onSegmentClick?: (name: string) => void
  }
}

export interface FunnelChartWidget extends BaseWidget {
  type: "funnel-chart"
  data: {
    stages: Array<{ name: string; value: number; color?: string }>
  }
}

export interface MetricsWidget extends BaseWidget {
  type: "metrics"
  data: {
    metrics: Array<{
      label: string
      value: number
      max: number
      color?: string
    }>
  }
}

export interface TableWidget extends BaseWidget {
  type: "table"
  data: {
    columns: Array<{
      key: string
      label: string
      align?: "left" | "center" | "right"
    }>
    rows: Array<{ [key: string]: string | number | ReactNode }>
  }
}

export interface StatCardsWidget extends BaseWidget {
  type: "stat-cards"
  data: {
    stats: Array<{
      label: string
      value: string | number
      change?: number
      /** Comparison the change refers to, e.g. "vs last month". */
      changeLabel?: string
      /** A rise is bad (costs, overdue): colours flip. */
      invertChange?: boolean
      icon?: string
      testId?: string
      onClick?: () => void
    }>
  }
}

export interface CustomWidget extends BaseWidget {
  type: "custom"
  component: React.ComponentType<{ data: unknown }>
  data: unknown
}

export interface OverdueInvoicesWidget extends BaseWidget {
  type: "overdue-invoices"
  data: { count: number; totalAmount: number; oldestDays: number }
}

export interface CashFlowWidget extends BaseWidget {
  type: "cash-flow"
  data: { arTotal: number; apTotal: number; netPosition: number }
}

export interface BudgetProgressWidget extends BaseWidget {
  type: "budget-progress"
  data: { budgets: Array<{ name: string; planned: number; actual: number; variance: number }> }
}

export interface TaxDeadlineWidget extends BaseWidget {
  type: "tax-deadline"
  data: { deadlines: Array<{ title: string; dueDate: string; status: string; daysUntil: number }> }
}

export interface AccountBalanceWidget extends BaseWidget {
  type: "account-balance"
  data: { accounts: Array<{ code: string; name: string; balance: number; type: string }> }
}

export interface IosTilesWidget extends BaseWidget {
  type: "ios-tiles"
  data: {
    tiles: Array<{
      id: string
      label: string
      value: string | number
      subtitle?: string
      icon?: React.ReactNode
      color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
      progress?: number
      sparkline?: number[]
      size?: "small" | "medium" | "large"
    }>
  }
}

export interface ActivityRingsWidget extends BaseWidget {
  type: "activity-rings"
  data: {
    rings: Array<{
      id: string
      label: string
      value: number
      max: number
      color: "red" | "green" | "blue" | "orange" | "purple" | "teal"
      unit?: string
    }>
    showLegend?: boolean
    size?: "sm" | "md" | "lg"
  }
}

export interface CountdownWidget extends BaseWidget {
  type: "countdown"
  data: {
    items: Array<{
      id: string
      label: string
      value: number
      unit: string
      maxValue?: number
      color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
    }>
    layout?: "horizontal" | "grid"
  }
}

export interface QuickActionsWidget extends BaseWidget {
  type: "quick-actions"
  data: {
    actions: Array<{
      id: string
      label: string
      icon: string
      color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
      onClick?: () => void
    }>
    columns?: 2 | 3 | 4 | 6
  }
}

export interface ComboChartWidget extends BaseWidget {
  type: "combo-chart"
  data: {
    xAxisKey: string
    bars: ChartSeriesSpec[]
    line: ChartSeriesSpec
    /** "right" (default) gives the line its own axis; "left" shares the bars' axis. */
    lineAxis?: "left" | "right"
    stacked?: boolean
    values: ChartDatum[]
    valueFormat?: ChartValueFormat
    lineFormat?: ChartValueFormat
  }
}

export interface StepChartWidget extends BaseWidget {
  type: "step-chart"
  data: {
    xAxisKey: string
    series: ChartSeriesSpec
    values: ChartDatum[]
    variant?: "line" | "bar"
    /** Flagged x values; omitted → outliers are detected automatically. */
    anomalies?: string[]
    reference?: { value: number; label: string }
    valueFormat?: ChartValueFormat
  }
}

export interface RankedBarsWidget extends BaseWidget {
  type: "ranked-bars"
  data: {
    items: RankedBarItem[]
    valueFormat?: ChartValueFormat
    maxItems?: number
    changeLabel?: string
    emptyLabel?: string
    onItemClick?: (label: string) => void
  }
}

export interface ShareBarWidget extends BaseWidget {
  type: "share-bar"
  data: {
    segments: ChartSeriesSpec[]
    rows: ShareBarRow[]
    valueFormat?: ChartValueFormat
    showTable?: boolean
    emptyLabel?: string
  }
}

export interface RadialGaugeWidget extends BaseWidget {
  type: "radial-gauge"
  data: {
    value: number
    max: number
    label: string
    valueFormat?: ChartValueFormat
    /** Centre text written out in full; wins over `valueFormat`. */
    display?: string
    stats?: RadialGaugeStat[]
    tone?: RadialGaugeTone
  }
}

/** A table row in a tabbed table: the row's fields plus the tabs it shows under. */
export interface TabbedTableRow extends EntityRow {
  id: string | number
  tabIds: string[]
}

export interface TabbedTableWidget extends BaseWidget {
  type: "tabbed-table"
  data: {
    /** A tab with id "all" lists every row; any other tab lists rows whose `tabIds` include it. */
    tabs: Array<{ id: string; label: string }>
    columns: EntityColumn[]
    rows: TabbedTableRow[]
    emptyMessage?: string
    onRowClick?: (row: TabbedTableRow) => void
  }
}

export type DashboardWidget =
  | KPIWidget
  | DiagnosticWidget
  | AreaChartWidget
  | LineChartWidget
  | BarChartWidget
  | DonutChartWidget
  | FunnelChartWidget
  | MetricsWidget
  | TableWidget
  | StatCardsWidget
  | CustomWidget
  | OverdueInvoicesWidget
  | CashFlowWidget
  | BudgetProgressWidget
  | TaxDeadlineWidget
  | AccountBalanceWidget
  | IosTilesWidget
  | ActivityRingsWidget
  | CountdownWidget
  | QuickActionsWidget
  | ComboChartWidget
  | StepChartWidget
  | RankedBarsWidget
  | ShareBarWidget
  | RadialGaugeWidget
  | TabbedTableWidget

export interface DashboardSection {
  id: string
  title?: string
  widgets: DashboardWidget[]
}

export interface DashboardConfig {
  id: string
  title: string
  description?: string
  sections: DashboardSection[]
}

export const gridWidthClasses: Record<GridWidth, string> = {
  full: "col-span-12",
  "2/3": "col-span-12 lg:col-span-8",
  "1/2": "col-span-12 md:col-span-6",
  "1/3": "col-span-12 md:col-span-6 lg:col-span-4",
}
