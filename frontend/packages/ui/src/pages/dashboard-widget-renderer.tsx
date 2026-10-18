"use client"

import { useRef } from "react"
import { Download, FileDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "../components/card"
import { Button } from "../components/button"
import { Skeleton } from "../components/skeleton"
import type { DashboardWidget, WidgetType } from "../lib/dashboard-types"
import { exportChartToPng } from "../lib/export-dashboard-png"
import { downloadCsv, widgetDataToCsv } from "../lib/export-csv"
import type { ReportExportSourceProvenance } from "../lib/report-export-provenance"
import { KPIWidget } from "./widgets/kpi-widget"
import { AreaChartWidget } from "./widgets/area-chart-widget"
import { LineChartWidget } from "./widgets/line-chart-widget"
import { BarChartWidget } from "./widgets/bar-chart-widget"
import { DonutChartWidget } from "./widgets/donut-chart-widget"
import { FunnelChartWidget } from "./widgets/funnel-chart-widget"
import { MetricsWidget } from "./widgets/metrics-widget"
import { TableWidget } from "./widgets/table-widget"
import { StatCardsWidget } from "./widgets/stat-cards-widget"
import { OverdueInvoicesWidget as OverdueInvoicesWidgetComp } from "./widgets/overdue-invoices-widget"
import { CashFlowWidget as CashFlowWidgetComp } from "./widgets/cash-flow-widget"
import { BudgetProgressWidget as BudgetProgressWidgetComp } from "./widgets/budget-progress-widget"
import { TaxDeadlineWidget as TaxDeadlineWidgetComp } from "./widgets/tax-deadline-widget"
import { AccountBalanceWidget as AccountBalanceWidgetComp } from "./widgets/account-balance-widget"
import { ActivityRingWidget } from "./widgets/activity-ring-widget"
import { CountdownWidget } from "./widgets/countdown-widget"
import { IosTileWidget } from "./widgets/ios-tile-widget"
import { QuickActionsWidget } from "./widgets/quick-actions-widget"
import { TabbedTableWidget } from "./widgets/tabbed-table-widget"
import { ComboTrendChart } from "../charts/combo-trend-chart"
import { StepAnomalyChart } from "../charts/step-anomaly-chart"
import { RankedBarList } from "../charts/ranked-bar-list"
import { SegmentedShareBar } from "../charts/segmented-share-bar"
import { RadialGauge } from "../charts/radial-gauge"

interface WidgetRendererProps {
  widget: DashboardWidget
  widthClass: string
  testId?: string
  /** While the module's data loads, show a placeholder instead of zeros. */
  isLoading?: boolean
  exportProvenance?: ReportExportSourceProvenance
}

/** A chart with no points, or only zero values, renders as an empty frame. */
function chartIsEmpty(widget: DashboardWidget): boolean {
  switch (widget.type) {
    case "area-chart":
    case "line-chart":
    case "bar-chart": {
      const names = widget.data.series.map((series) => series.name)
      return !widget.data.values.some((point) =>
        names.some((name) => Number(point[name] ?? 0) !== 0),
      )
    }
    case "funnel-chart":
      return !widget.data.stages.some((stage) => stage.value !== 0)
    case "combo-chart": {
      const keys = [...widget.data.bars.map((bar) => bar.key), widget.data.line.key]
      return !widget.data.values.some((point) => keys.some((key) => Number(point[key] ?? 0) !== 0))
    }
    case "step-chart":
      return !widget.data.values.some((point) => Number(point[widget.data.series.key] ?? 0) !== 0)
    case "ranked-bars":
      return !widget.data.items.some((item) => item.value > 0)
    case "share-bar":
      return !widget.data.rows.some((row) => Object.values(row.values).some((value) => value > 0))
    case "radial-gauge":
      return !(widget.data.max > 0)
    default:
      return false
  }
}

/** The widget's own empty-state wording, when it sets one. */
function emptyLabelOf(widget: DashboardWidget): string | undefined {
  switch (widget.type) {
    case "donut-chart":
    case "ranked-bars":
    case "share-bar":
      return widget.data.emptyLabel
    default:
      return undefined
  }
}

const CHART_WIDGET_TYPES = new Set<WidgetType>([
  "area-chart",
  "line-chart",
  "bar-chart",
  "donut-chart",
  "funnel-chart",
  "combo-chart",
  "step-chart",
  "ranked-bars",
  "share-bar",
  "radial-gauge",
])

export function DashboardWidgetRenderer({ widget, widthClass, testId, isLoading = false, exportProvenance }: WidgetRendererProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const useCard = widget.useCard !== false
  const isChart = CHART_WIDGET_TYPES.has(widget.type)
  const canExportCsv = (isChart && widget.type !== "radial-gauge") || widget.type === "table" || widget.type === "tabbed-table"

  const renderContent = () => {
    if (isLoading && widget.type !== "quick-actions" && widget.type !== "custom") {
      return (
        <Skeleton
          className={isChart ? "h-56 w-full" : "h-16 w-full"}
          data-testid={testId ? `${testId}-loading` : undefined}
        />
      )
    }
    if (isChart && chartIsEmpty(widget)) {
      return (
        <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          {emptyLabelOf(widget) ?? "No data for this period yet."}
        </div>
      )
    }
    switch (widget.type) {
      case "diagnostic":
        return (
          <div
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
            data-testid="dashboard-widget-diagnostic"
          >
            <p>{widget.data.message}</p>
            {widget.data.rejectedRows != null ? (
              <p className="text-xs">
                {widget.data.rejectedRows} source {widget.data.rejectedRows === 1 ? "row was" : "rows were"} rejected.
              </p>
            ) : null}
          </div>
        )
      case "kpi":
        return <KPIWidget data={widget.data} />
      case "area-chart":
        return <AreaChartWidget data={widget.data} />
      case "line-chart":
        return <LineChartWidget data={widget.data} />
      case "bar-chart":
        return <BarChartWidget data={widget.data} />
      case "donut-chart":
        return <DonutChartWidget data={widget.data} />
      case "funnel-chart":
        return <FunnelChartWidget data={widget.data} />
      case "metrics":
        return <MetricsWidget data={widget.data} />
      case "table":
        return <TableWidget data={widget.data} />
      case "stat-cards":
        return <StatCardsWidget data={widget.data} />
      case "overdue-invoices":
        return <OverdueInvoicesWidgetComp data={widget.data} />
      case "cash-flow":
        return <CashFlowWidgetComp data={widget.data} />
      case "budget-progress":
        return <BudgetProgressWidgetComp data={widget.data} />
      case "tax-deadline":
        return <TaxDeadlineWidgetComp data={widget.data} />
      case "account-balance":
        return <AccountBalanceWidgetComp data={widget.data} />
      case "activity-rings":
        return <ActivityRingWidget data={widget.data} />
      case "countdown":
        return <CountdownWidget data={widget.data} />
      case "ios-tiles":
        return <IosTileWidget data={widget.data} />
      case "quick-actions":
        return <QuickActionsWidget data={widget.data} />
      case "combo-chart":
        return <ComboTrendChart {...widget.data} />
      case "step-chart":
        return <StepAnomalyChart {...widget.data} />
      case "ranked-bars":
        return <RankedBarList {...widget.data} />
      case "share-bar":
        return <SegmentedShareBar {...widget.data} />
      case "radial-gauge":
        return <RadialGauge {...widget.data} />
      case "tabbed-table":
        return <TabbedTableWidget data={widget.data} />
      case "custom": {
        const CustomComponent = widget.component
        return <CustomComponent data={widget.data} />
      }
      default:
        return null
    }
  }

  const handleChartExport = async () => {
    if (!chartRef.current) return
    await exportChartToPng(chartRef.current, widget.title || widget.id, exportProvenance)
  }

  const handleCsvExport = () => {
    const csv = widgetDataToCsv(widget, exportProvenance)
    if (csv !== null) downloadCsv(widget.title || widget.id, csv)
  }

  const exportButtons = (
    <>
      {isChart ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Export ${widget.title} chart`}
          onClick={() => void handleChartExport()}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {canExportCsv ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Export ${widget.title} as CSV`}
          onClick={handleCsvExport}
        >
          <FileDown className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </>
  )

  if (!useCard) {
    return (
      <div className={widthClass} data-testid={testId}>
        <div className="mb-3 flex items-center justify-between gap-2">
          {widget.title ? (
            <h3 className="text-sm font-medium text-muted-foreground">{widget.title}</h3>
          ) : (
            <span />
          )}
          {isChart || canExportCsv ? (
            <div className="flex items-center gap-1">{exportButtons}</div>
          ) : null}
        </div>
        <div ref={isChart ? chartRef : undefined}>{renderContent()}</div>
      </div>
    )
  }

  return (
    <div className={widthClass} data-testid={testId}>
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
          <CardTitle className="text-sm font-semibold">{widget.title}</CardTitle>
          {isChart || canExportCsv ? (
            <div className="flex shrink-0 items-center gap-1">{exportButtons}</div>
          ) : null}
        </CardHeader>
        <CardContent>
          <div ref={isChart ? chartRef : undefined}>{renderContent()}</div>
        </CardContent>
      </Card>
    </div>
  )
}
