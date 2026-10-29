"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { PieChart, Pie, Cell } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/chart"
import type { DonutChartWidget as DonutChartWidgetType } from "../../lib/dashboard-types"

const FALLBACK_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

export function DonutChartWidget({ data }: { data: DonutChartWidgetType["data"] }) {
  useTranslation()
  const segments = data.segments
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  if (segments.length === 0 || total === 0) {
    return (
      <div className="flex h-[300px] w-full items-center justify-center text-sm text-muted-foreground">
        {data.emptyLabel ?? i18n.t("ui.pages.donutChartWidget.noData")}
      </div>
    )
  }

  const segmentColor = (color: string | undefined, index: number) =>
    color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]

  const percentOf = (value: number) => `${((value / total) * 100).toFixed(1)}%`
  const config: ChartConfig = {}
  for (const segment of segments) config[segment.name] = { label: segment.name }

  return (
    <div className="flex h-[300px] w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={data.innerRadius ?? "62%"}
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
              onClick={(segment) => {
                if (data.onSegmentClick && segment?.name) {
                  data.onSegmentClick(String(segment.name))
                }
              }}
              style={{ cursor: data.onSegmentClick ? "pointer" : "default" }}
            >
              {segments.map((segment, index) => (
                <Cell key={segment.name} fill={segmentColor(segment.color, index)} />
              ))}
            </Pie>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="name"
                  formatter={(value, name, item) => (
                    <div className="flex w-full min-w-36 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: typeof item.payload?.fill === "string" ? item.payload.fill : undefined }}
                      />
                      <span className="text-muted-foreground">{String(name)}</span>
                      <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">
                        {Number(value).toLocaleString()} ({percentOf(Number(value))})
                      </span>
                    </div>
                  )}
                />
              }
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {total.toLocaleString()}
          </span>
          {data.centerLabel ? (
            <span className="text-xs text-muted-foreground">{data.centerLabel}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3">
        {segments.map((segment, index) => {
          const item = (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: segmentColor(segment.color, index) }}
              />
              <span className="text-xs text-foreground">{segment.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {percentOf(segment.value)}
              </span>
            </>
          )

          return data.onSegmentClick ? (
            <button
              key={segment.name}
              type="button"
              className="flex items-center gap-1.5 rounded hover:opacity-70"
              onClick={() => data.onSegmentClick?.(segment.name)}
            >
              {item}
            </button>
          ) : (
            <span key={segment.name} className="flex items-center gap-1.5">
              {item}
            </span>
          )
        })}
      </div>
    </div>
  )
}
