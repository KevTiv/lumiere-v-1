"use client"

import { useRef } from "react"
import { Download } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "../components/card"
import { Button } from "../components/button"
import type { DashboardWidget, WidgetType } from "../lib/dashboard-types"
import { exportChartToPng } from "../lib/export-dashboard-png"
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

interface WidgetRendererProps {
  widget: DashboardWidget
  widthClass: string
  testId?: string
}

const CHART_WIDGET_TYPES = new Set<WidgetType>([
  "area-chart",
  "line-chart",
  "bar-chart",
  "donut-chart",
  "funnel-chart",
])

export function DashboardWidgetRenderer({ widget, widthClass, testId }: WidgetRendererProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const useCard = widget.useCard !== false
  const isChart = CHART_WIDGET_TYPES.has(widget.type)

  const renderContent = () => {
    switch (widget.type) {
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
    await exportChartToPng(chartRef.current, widget.title || widget.id)
  }

  if (!useCard) {
    return (
      <div className={widthClass} data-testid={testId}>
        <div className="mb-3 flex items-center justify-between gap-2">
          {widget.title ? (
            <h3 className="text-sm font-medium text-muted-foreground">{widget.title}</h3>
          ) : (
            <span />
          )}
          {isChart ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Export ${widget.title} chart`}
              onClick={() => void handleChartExport()}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
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
        </CardHeader>
        <CardContent>
          <div ref={isChart ? chartRef : undefined}>{renderContent()}</div>
        </CardContent>
      </Card>
    </div>
  )
}
