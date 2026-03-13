"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardWidget } from "@/lib/dashboard-types"
import { KPIWidget } from "./widgets/kpi-widget"
import { AreaChartWidget } from "./widgets/area-chart-widget"
import { BarChartWidget } from "./widgets/bar-chart-widget"
import { MetricsWidget } from "./widgets/metrics-widget"
import { TableWidget } from "./widgets/table-widget"
import { StatCardsWidget } from "./widgets/stat-cards-widget"
import { IosTileWidget } from "./widgets/ios-tile-widget"
import { ActivityRingWidget } from "./widgets/activity-ring-widget"
import { CountdownWidget } from "./widgets/countdown-widget"
import { QuickActionsWidget } from "./widgets/quick-actions-widget"

interface WidgetRendererProps {
  widget: DashboardWidget
  widthClass: string
}

export function DashboardWidgetRenderer({ widget, widthClass }: WidgetRendererProps) {
  const useCard = widget.useCard !== false

  const renderContent = () => {
    switch (widget.type) {
      case "kpi":
        return <KPIWidget data={widget.data} />
      case "area-chart":
        return <AreaChartWidget data={widget.data} />
      case "bar-chart":
        return <BarChartWidget data={widget.data} />
      case "metrics":
        return <MetricsWidget data={widget.data} />
      case "table":
        return <TableWidget data={widget.data} />
      case "stat-cards":
        return <StatCardsWidget data={widget.data} />
      case "ios-tiles":
        return <IosTileWidget data={widget.data} />
      case "activity-rings":
        return <ActivityRingWidget data={widget.data} />
      case "countdown":
        return <CountdownWidget data={widget.data} />
      case "quick-actions":
        return <QuickActionsWidget data={widget.data} />
      case "custom":
        const CustomComponent = widget.component
        return <CustomComponent data={widget.data} />
      default:
        return null
    }
  }

  if (!useCard) {
    return (
      <div className={widthClass}>
        {widget.title && (
          <h3 className="text-lg font-semibold mb-4">{widget.title}</h3>
        )}
        {renderContent()}
      </div>
    )
  }

  return (
    <div className={widthClass}>
      <Card className="h-full bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">{widget.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  )
}
