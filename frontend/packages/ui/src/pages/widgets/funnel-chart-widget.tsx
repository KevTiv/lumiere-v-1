"use client"

import type { FunnelChartWidget as FunnelChartWidgetType } from "../../lib/dashboard-types"

const DEFAULT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

export function FunnelChartWidget({ data }: { data: FunnelChartWidgetType["data"] }) {
  const maxValue = data.stages[0]?.value ?? 1

  return (
    <div className="flex h-[300px] w-full flex-col justify-center gap-2">
      {data.stages.map((stage, index) => {
        const widthPercent = maxValue > 0 ? (stage.value / maxValue) * 100 : 0
        const prevValue = index > 0 ? data.stages[index - 1].value : null
        const conversion =
          prevValue && prevValue > 0
            ? Math.round((stage.value / prevValue) * 100)
            : null
        const color = stage.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]

        return (
          <div key={stage.name} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-right text-xs text-muted-foreground">
              {stage.name}
            </div>
            <div className="relative flex-1">
              <div
                className="flex h-8 items-center justify-end rounded px-2 text-xs font-medium text-primary-foreground transition-all"
                style={{
                  width: `${Math.max(widthPercent, 8)}%`,
                  backgroundColor: color,
                  marginLeft: `${(100 - Math.max(widthPercent, 8)) / 2}%`,
                }}
              >
                {stage.value.toLocaleString()}
              </div>
            </div>
            <div className="w-12 shrink-0 text-xs text-muted-foreground">
              {conversion !== null ? `${conversion}%` : "—"}
            </div>
          </div>
        )
      })}
    </div>
  )
}
