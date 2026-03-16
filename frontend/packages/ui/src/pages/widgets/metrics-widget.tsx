"use client"

import type { MetricsWidget as MetricsWidgetType } from "../../lib/dashboard-types"

export function MetricsWidget({ data }: { data: MetricsWidgetType["data"] }) {
  return (
    <div className="space-y-4">
      {data.metrics.map((metric, index) => {
        const percentage = Math.round((metric.value / metric.max) * 100)
        return (
          <div key={index} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{metric.label}</span>
              <span className="font-medium">{metric.value.toLocaleString()} / {metric.max.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: metric.color || "hsl(var(--primary))"
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
