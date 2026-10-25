"use client"

import type { ReactNode } from "react"
import { ChartTooltipContent, type ChartConfig } from "../components/chart"
import { chartColor, formatChartValue, type ChartSeriesSpec, type ChartValueFormat } from "../lib/chart-format"

/**
 * Labels for `ChartContainer`. Colours are passed straight to the marks instead of through
 * `--color-<key>` variables, so series keys never need to be CSS-identifier safe.
 */
export function seriesChartConfig(series: readonly ChartSeriesSpec[]): ChartConfig {
  const config: ChartConfig = {}
  for (const item of series) config[item.key] = { label: item.label }
  return config
}

/** The series colour, falling back to the theme token for its position. */
export function seriesColor(series: ChartSeriesSpec, index: number): string {
  return series.color ?? chartColor(index)
}

/** One tooltip row: swatch, series label, formatted value. */
function TooltipRow({ color, label, value }: { color?: string; label: ReactNode; value: string }) {
  return (
    <div className="flex w-full min-w-36 items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

/**
 * Tooltip content that formats every value with the chart's value format (money, percent…),
 * while keeping the shadcn tooltip frame. `formats` overrides the format for specific keys.
 */
export function valueTooltip(
  config: ChartConfig,
  format: ChartValueFormat | undefined,
  formats: { [key: string]: ChartValueFormat | undefined } = {},
  locale?: string,
) {
  return (
    <ChartTooltipContent
      formatter={(value, name, item) => {
        const key = String(name)
        const color = typeof item.color === "string" ? item.color : undefined
        return (
          <TooltipRow
            color={color}
            label={config[key]?.label ?? key}
            value={formatChartValue(Number(value), formats[key] ?? format, locale)}
          />
        )
      }}
    />
  )
}

/** Shared frame for an empty chart so every widget says the same thing. */
export function ChartEmpty({ label = "No data for this period yet.", className }: { label?: string; className?: string }) {
  return (
    <div
      className={
        className ??
        "flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
      }
    >
      {label}
    </div>
  )
}
