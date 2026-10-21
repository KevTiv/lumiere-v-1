"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../../components/chart"
import { formatChartTick } from "../../lib/chart-format"
import { seriesChartConfig } from "../../charts/chart-kit"
import type { LineChartWidget as LineChartWidgetType } from "../../lib/dashboard-types"

export function LineChartWidget({ data }: { data: LineChartWidgetType["data"] }) {
  const config = seriesChartConfig(data.series.map((s) => ({ key: s.name, label: s.name })))
  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <LineChart data={data.values} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={data.xAxisKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => formatChartTick(value)} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {data.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {data.series.map((s) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}
