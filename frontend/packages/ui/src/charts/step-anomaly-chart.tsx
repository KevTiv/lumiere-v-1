"use client"

import { useId } from "react"
import { Area, Bar, CartesianGrid, ComposedChart, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "../components/chart"
import { cn } from "../lib/utils"
import {
  chartColor,
  detectAnomalies,
  formatChartTick,
  formatChartValue,
  type ChartDatum,
  type ChartSeriesSpec,
  type ChartValueFormat,
} from "../lib/chart-format"
import { seriesChartConfig, valueTooltip } from "./chart-kit"

export interface StepAnomalyChartProps {
  values: ChartDatum[]
  xAxisKey: string
  series: ChartSeriesSpec
  /** "line": a stepped area (balances, running totals); "bar": one bar per period (movements). */
  variant?: "line" | "bar"
  /**
   * The x values to flag. When omitted, points far from the series' typical level are flagged
   * automatically (robust z-score, see `detectAnomalies`).
   */
  anomalies?: string[]
  /** A horizontal guide such as zero or a budget line. */
  reference?: { value: number; label: string }
  valueFormat?: ChartValueFormat
  className?: string
}

/** Flagged points of a series: explicit x values, or detected outliers. */
export function anomalyPoints(
  values: readonly ChartDatum[],
  xAxisKey: string,
  seriesKey: string,
  anomalies?: readonly string[],
): ChartDatum[] {
  if (anomalies) {
    const wanted = new Set(anomalies)
    return values.filter((point) => wanted.has(String(point[xAxisKey])))
  }
  const indexes = detectAnomalies(values.map((point) => Number(point[seriesKey] ?? 0)))
  return indexes.map((index) => values[index]!)
}

/** A stepped series with anomaly markers — cash movements, unusual spend. */
export function StepAnomalyChart({
  values,
  xAxisKey,
  series,
  variant = "line",
  anomalies,
  reference,
  valueFormat,
  className,
}: StepAnomalyChartProps) {
  const gradientId = `step-fill-${useId().replace(/:/g, "")}`
  const config = seriesChartConfig([series])
  const color = series.color ?? chartColor(0)
  const flagged = anomalyPoints(values, xAxisKey, series.key, anomalies)

  return (
    <div className={cn("w-full", className)}>
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
        <ComposedChart data={values} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={xAxisKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => formatChartTick(value, valueFormat)}
          />
          <ChartTooltip content={valueTooltip(config, valueFormat)} />
          {reference ? (
            <ReferenceLine
              y={reference.value}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
          ) : null}
          {variant === "bar" ? (
            <Bar dataKey={series.key} fill={color} radius={[3, 3, 0, 0]} maxBarSize={28} />
          ) : (
            <Area
              dataKey={series.key}
              type="step"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
          {flagged.map((point) => (
            <ReferenceDot
              key={String(point[xAxisKey])}
              x={point[xAxisKey]}
              y={Number(point[series.key] ?? 0)}
              r={6}
              fill="hsl(var(--destructive))"
              stroke="hsl(var(--background))"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ChartContainer>
      {flagged.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Anomalies">
          {flagged.map((point) => (
            <li key={String(point[xAxisKey])} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span>
                Unusual {String(point[xAxisKey])}:{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatChartValue(Number(point[series.key] ?? 0), valueFormat)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
