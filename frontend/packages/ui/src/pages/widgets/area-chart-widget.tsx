"use client"

import { useCurrencyFormat } from "../../lib/currency-context"
import { useId } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../../components/chart"
import { formatChartTick } from "../../lib/chart-format"
import { seriesChartConfig } from "../../charts/chart-kit"
import type { AreaChartWidget as AreaChartWidgetType } from "../../lib/dashboard-types"

export function AreaChartWidget({ data }: { data: AreaChartWidgetType["data"] }) {
  const { locale } = useCurrencyFormat()
  // Series names can hold spaces, so gradient ids come from a stable per-chart id plus the index.
  const gradientPrefix = `area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const config = seriesChartConfig(data.series.map((s) => ({ key: s.name, label: s.name })))
  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <AreaChart data={data.values} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          {data.series.map((s, index) => (
            <linearGradient key={s.name} id={`${gradientPrefix}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={data.xAxisKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
        <YAxis allowDecimals={data.allowDecimals} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => formatChartTick(value, undefined, locale)} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        {data.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {data.series.map((s, index) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#${gradientPrefix}-${index})`}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}
