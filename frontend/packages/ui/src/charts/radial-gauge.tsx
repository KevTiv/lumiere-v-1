"use client"

import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts"
import { ChartContainer } from "../components/chart"
import { cn } from "../lib/utils"
import { chartColor, formatChartValue, type ChartValueFormat } from "../lib/chart-format"

export type RadialGaugeTone = "default" | "success" | "warning" | "destructive"

export interface RadialGaugeStat {
  label: string
  value: string
}

export interface RadialGaugeProps {
  value: number
  /** The full-scale value; the arc fills `value / max`. */
  max: number
  /** Caption under the centre figure. */
  label: string
  /** How the centre figure is written. Defaults to the share of `max` as a percent. */
  valueFormat?: ChartValueFormat
  /** Centre text written out in full (e.g. "12+" or "∞"); wins over `valueFormat`. */
  display?: string
  /** Up to three figures under the gauge. */
  stats?: RadialGaugeStat[]
  tone?: RadialGaugeTone
  className?: string
}

const toneColor: Record<RadialGaugeTone, string> = {
  default: chartColor(0),
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
}

/** Fill fraction 0..1 of a gauge; empty when the scale is not positive. */
export function gaugeFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}

/** A half-circle gauge with a centre figure and three sub-stats — collection rate, cash runway. */
export function RadialGauge({ value, max, label, valueFormat, display, stats = [], tone = "default", className }: RadialGaugeProps) {
  const fraction = gaugeFraction(value, max)
  const color = toneColor[tone]
  const centre = display ?? (valueFormat ? formatChartValue(value, valueFormat) : formatChartValue(fraction * 100, { kind: "percent" }))

  return (
    <div className={cn("flex w-full flex-col items-center", className)}>
      <div className="relative w-full max-w-[280px]">
        <ChartContainer config={{ value: { label } }} className="aspect-[2/1] w-full">
          <RadialBarChart
            data={[{ name: "value", value: fraction * 100, fill: color }]}
            startAngle={180}
            endAngle={0}
            cy="100%"
            innerRadius="140%"
            outerRadius="190%"
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" background cornerRadius={8} isAnimationActive={false} />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">{centre}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      </div>
      {stats.length > 0 ? (
        <dl className="mt-4 grid w-full grid-cols-3 divide-x divide-border border-t border-border pt-3">
          {stats.slice(0, 3).map((stat) => (
            <div key={stat.label} className="min-w-0 px-2 text-center">
              <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
