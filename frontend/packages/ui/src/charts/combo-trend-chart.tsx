"use client"

import { useCurrencyFormat } from "../lib/currency-context"
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "../components/chart"
import { cn } from "../lib/utils"
import { chartColor, formatChartTick, type ChartDatum, type ChartSeriesSpec, type ChartValueFormat } from "../lib/chart-format"
import { seriesChartConfig, seriesColor, valueTooltip } from "./chart-kit"

export interface ComboTrendChartProps {
  values: ChartDatum[]
  xAxisKey: string
  /** Bars on the left axis (grouped, or stacked with `stacked`). */
  bars: ChartSeriesSpec[]
  /** The trend line. On the right axis unless `lineAxis` is "left" (same unit as the bars). */
  line: ChartSeriesSpec
  lineAxis?: "left" | "right"
  stacked?: boolean
  valueFormat?: ChartValueFormat
  /** Format of the line's values when it has its own axis (e.g. a percent margin). */
  lineFormat?: ChartValueFormat
  className?: string
}

/** Bars plus a line over the same categories — revenue vs expenses with net, MRR with churn. */
export function ComboTrendChart({
  values,
  xAxisKey,
  bars,
  line,
  lineAxis = "right",
  stacked = false,
  valueFormat,
  lineFormat,
  className,
}: ComboTrendChartProps) {
  const { locale } = useCurrencyFormat()
  const config = seriesChartConfig([...bars, line])
  const lineColor = line.color ?? chartColor(bars.length)
  const ownAxis = lineAxis === "right"
  const lineValueFormat = ownAxis ? (lineFormat ?? valueFormat) : valueFormat

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-[280px] w-full", className)}>
      <ComposedChart data={values} margin={{ top: 8, right: ownAxis ? 0 : 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xAxisKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value: number) => formatChartTick(value, valueFormat, locale)}
        />
        {ownAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => formatChartTick(value, lineValueFormat, locale)}
          />
        ) : null}
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={valueTooltip(config, valueFormat, { [line.key]: lineValueFormat }, locale)} />
        <ChartLegend content={<ChartLegendContent />} />
        {bars.map((bar, index) => (
          <Bar
            key={bar.key}
            yAxisId="left"
            dataKey={bar.key}
            fill={seriesColor(bar, index)}
            radius={stacked ? (index === bars.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
            stackId={stacked ? "stack" : undefined}
            maxBarSize={36}
          />
        ))}
        <Line
          yAxisId={ownAxis ? "right" : "left"}
          dataKey={line.key}
          type="monotone"
          stroke={lineColor}
          strokeWidth={2}
          dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
