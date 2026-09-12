import {
  type DashboardData,
  type DashboardDefinition,
  type MetricGroupDefinition,
  type ReportTableDefinition,
  type TimeSeriesDefinition,
} from "@lumiere/presentation-core"
import type { DashboardSection, DashboardWidget } from "./dashboard-types"

type Translate = (key: string) => string

export interface PresentationDashboardOptions {
  readonly metricGroups?: Readonly<Record<string, {
    readonly width?: DashboardWidget["width"]
    readonly icons?: Readonly<Record<string, string>>
    readonly testIds?: Readonly<Record<string, string>>
  }>>
  readonly timeSeries?: Readonly<Record<string, {
    readonly width?: DashboardWidget["width"]
    readonly color?: string
    readonly xAxisKey?: string
  }>>
  readonly reportTables?: Readonly<Record<string, {
    readonly width?: DashboardWidget["width"]
    readonly columnAlign?: Readonly<Record<string, "left" | "center" | "right">>
  }>>
}

export const overviewDashboardWebOptions: PresentationDashboardOptions = {
  metricGroups: {
    "overview-stat-cards": {
      width: "full",
      icons: { revenue: "BarChart2", "open-sales-orders": "ShoppingCart", "open-tasks": "CheckSquare", contacts: "Users" },
      testIds: { revenue: "overview-stat-revenue", "open-sales-orders": "overview-stat-open-sales-orders", "open-tasks": "overview-stat-open-tasks", contacts: "overview-stat-contacts" },
    },
  },
  timeSeries: { "overview-sales-trend": { width: "full", color: "hsl(var(--chart-1))", xAxisKey: "month" } },
  reportTables: { "overview-needs-attention": { width: "full", columnAlign: { amount: "right" } } },
}

function requiredBinding<T>(values: Readonly<Record<string, T>>, binding: string, widgetId: string): T {
  if (!Object.hasOwn(values, binding) || values[binding] === undefined) {
    throw new Error(`missing dashboard binding ${binding} for ${widgetId}`)
  }
  return values[binding]!
}

function metricGroupWidget(
  definition: MetricGroupDefinition,
  data: DashboardData,
  t: Translate,
  options: PresentationDashboardOptions,
): DashboardWidget {
  const option = options.metricGroups?.[definition.id]
  return {
    id: definition.id,
    type: "stat-cards",
    title: t(definition.titleKey),
    width: option?.width ?? "full",
    data: {
      stats: definition.metrics.map((metric) => {
        const value = requiredBinding(data.metrics, metric.binding, definition.id)
        return {
          label: t(metric.labelKey),
          value: value.value,
          change: value.change,
          icon: option?.icons?.[metric.id],
          testId: option?.testIds?.[metric.id],
        }
      }),
    },
  }
}

function timeSeriesWidget(
  definition: TimeSeriesDefinition,
  data: DashboardData,
  t: Translate,
  options: PresentationDashboardOptions,
): DashboardWidget {
  const option = options.timeSeries?.[definition.id]
  const categoryKey = option?.xAxisKey ?? "label"
  const pointsByLabel = new Map<string, Record<string, string | number>>()
  for (const series of definition.series) {
    if (series.id === categoryKey) throw new Error(`dashboard series collides with category ${categoryKey}`)
    for (const point of requiredBinding(data.series, series.binding, definition.id)) {
      const row = pointsByLabel.get(point.label) ?? { [categoryKey]: point.label }
      row[series.id] = point.value
      pointsByLabel.set(point.label, row)
    }
  }
  return {
    id: definition.id,
    type: "bar-chart",
    title: t(definition.titleKey),
    width: option?.width ?? "full",
    data: {
      categoryKey,
      series: definition.series.map((series) => ({
        name: series.id,
        color: option?.color ?? "hsl(var(--chart-1))",
      })),
      values: [...pointsByLabel.values()],
    },
  }
}

function reportTableWidget(
  definition: ReportTableDefinition,
  data: DashboardData,
  t: Translate,
  options: PresentationDashboardOptions,
): DashboardWidget {
  const option = options.reportTables?.[definition.id]
  return {
    id: definition.id,
    type: "table",
    title: t(definition.titleKey),
    width: option?.width ?? "full",
    data: {
      columns: definition.columns.map((column) => ({ key: column.id, label: t(column.labelKey), align: option?.columnAlign?.[column.id] })),
      rows: requiredBinding(data.tables, definition.binding, definition.id).map((row) => {
        for (const column of definition.columns) requiredBinding(row, column.id, definition.id)
        return { ...row }
      }),
    },
  }
}

function widget(
  definition: DashboardDefinition["sections"][number]["widgets"][number],
  data: DashboardData,
  t: Translate,
  options: PresentationDashboardOptions,
): DashboardWidget {
  switch (definition.kind) {
    case "metric-group":
      return metricGroupWidget(definition, data, t, options)
    case "time-series":
      return timeSeriesWidget(definition, data, t, options)
    case "report-table":
      return reportTableWidget(definition, data, t, options)
    default: {
      const exhaustive: never = definition
      throw new Error(`unsupported dashboard widget: ${String(exhaustive)}`)
    }
  }
}

/** Adapt trusted static definitions. Missing bindings are wiring errors; empty arrays are valid data.
 * This is not a validator for runtime/admin-authored presentation payloads.
 */
export function toDashboardSections(
  definition: DashboardDefinition,
  data: DashboardData,
  t: Translate,
  options: PresentationDashboardOptions = {},
): DashboardSection[] {
  if (definition.schemaVersion !== 1) throw new Error("unsupported dashboard schema version")
  return definition.sections.map((section) => ({
    id: section.id,
    title: section.titleKey ? t(section.titleKey) : undefined,
    widgets: section.widgets.map((entry) => widget(entry, data, t, options)),
  }))
}
