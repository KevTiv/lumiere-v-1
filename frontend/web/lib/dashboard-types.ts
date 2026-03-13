export type GridWidth = "full" | "2/3" | "1/2" | "1/3"

export type WidgetType = 
  | "kpi"
  | "area-chart"
  | "bar-chart"
  | "metrics"
  | "table"
  | "stat-cards"
  | "ios-tiles"
  | "activity-rings"
  | "countdown"
  | "quick-actions"
  | "custom"

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
    rows: Array<{ [key: string]: string | number | React.ReactNode }>
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

export interface CustomWidget extends BaseWidget {
  type: "custom"
  component: React.ComponentType<{ data: unknown }>
  data: unknown
}

export type DashboardWidget =
  | KPIWidget
  | AreaChartWidget
  | BarChartWidget
  | MetricsWidget
  | TableWidget
  | StatCardsWidget
  | IosTilesWidget
  | ActivityRingsWidget
  | CountdownWidget
  | QuickActionsWidget
  | CustomWidget

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
