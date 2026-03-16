import type { ReactNode } from "react"

export type GridWidth = "full" | "2/3" | "1/2" | "1/3"

export type WidgetType =
  | "kpi"
  | "area-chart"
  | "bar-chart"
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

export interface AreaChartWidget extends BaseWidget {
  type: "area-chart"
  data: {
    series: { name: string; color: string }[]
    values: Array<{ [key: string]: string | number }>
    xAxisKey: string
  }
}

export interface BarChartWidget extends BaseWidget {
  type: "bar-chart"
  data: {
    series: { name: string; color: string }[]
    values: Array<{ [key: string]: string | number }>
    categoryKey: string
    layout?: "horizontal" | "vertical"
    stacked?: boolean
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
      icon?: string
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
    columns?: 2 | 3 | 4
  }
}

export type DashboardWidget =
  | KPIWidget
  | AreaChartWidget
  | BarChartWidget
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
