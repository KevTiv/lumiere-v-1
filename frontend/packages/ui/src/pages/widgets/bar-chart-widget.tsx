"use client"

import { useCurrencyFormat } from "../../lib/currency-context"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../../components/chart"
import { formatChartTick } from "../../lib/chart-format"
import { seriesChartConfig } from "../../charts/chart-kit"
import type { BarChartWidget as BarChartWidgetType } from "../../lib/dashboard-types"

export function BarChartWidget({ data }: { data: BarChartWidgetType["data"] }) {
  const { locale } = useCurrencyFormat()
  const isHorizontal = data.layout === "horizontal"
  const clickable = Boolean(data.onCategoryClick || data.onSegmentClick)
  const config = seriesChartConfig(data.series.map((s) => ({ key: s.name, label: s.name })))

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <BarChart
        data={data.values}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={!isHorizontal} vertical={isHorizontal} />
        {isHorizontal ? (
          <>
            <XAxis allowDecimals={data.allowDecimals} type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => formatChartTick(value, undefined, locale)} />
            <YAxis type="category" dataKey={data.categoryKey} tickLine={false} axisLine={false} width={80} />
          </>
        ) : (
          <>
            <XAxis dataKey={data.categoryKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} />
            <YAxis allowDecimals={data.allowDecimals} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => formatChartTick(value, undefined, locale)} />
          </>
        )}
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
        {data.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {data.series.map((s) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            fill={s.color}
            radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={40}
            stackId={data.stacked ? "stack" : undefined}
            style={{ cursor: clickable ? "pointer" : "default" }}
            onClick={(row: { payload?: { [key: string]: string | number } }) => {
              const category = row?.payload?.[data.categoryKey]
              if (data.onCategoryClick && category != null) {
                data.onCategoryClick(String(category))
              }
              if (data.onSegmentClick) {
                data.onSegmentClick(s.name)
              }
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
