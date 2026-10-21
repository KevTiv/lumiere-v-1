"use client"

import { Bar, BarChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/chart"
import { cn } from "../lib/utils"
import { formatChartValue, shareOf, type ChartSeriesSpec, type ChartValueFormat } from "../lib/chart-format"
import { ChartEmpty, seriesChartConfig, seriesColor } from "./chart-kit"

export interface ShareBarRow {
  label: string
  /** Amount per segment key. */
  values: { [segmentKey: string]: number }
}

export interface SegmentedShareBarProps {
  /** The parts, in display order (e.g. aging buckets, plans). */
  segments: ChartSeriesSpec[]
  /** One 100% bar per row (e.g. AR and AP). A single row hides the row labels. */
  rows: ShareBarRow[]
  valueFormat?: ChartValueFormat
  /** Show the breakdown table under the bar. Defaults to true. */
  showTable?: boolean
  emptyLabel?: string
  className?: string
}

interface ShareDatum {
  label: string
  total: number
  [key: string]: string | number
}

const ABS_PREFIX = "abs:"

/** Each row's segments as percent shares (for the bar) plus the absolute amounts (for tooltips). */
export function shareRows(segments: readonly ChartSeriesSpec[], rows: readonly ShareBarRow[]): ShareDatum[] {
  return rows.map((row) => {
    const total = segments.reduce((sum, segment) => sum + Math.max(0, row.values[segment.key] ?? 0), 0)
    const datum: ShareDatum = { label: row.label, total }
    for (const segment of segments) {
      const amount = Math.max(0, row.values[segment.key] ?? 0)
      datum[segment.key] = shareOf(amount, total)
      datum[`${ABS_PREFIX}${segment.key}`] = amount
    }
    return datum
  })
}

/** A 100% stacked bar with legend and breakdown table — revenue mix, AR aging share, plan mix. */
export function SegmentedShareBar({
  segments,
  rows,
  valueFormat,
  showTable = true,
  emptyLabel,
  className,
}: SegmentedShareBarProps) {
  const data = shareRows(segments, rows)
  if (!data.some((row) => row.total > 0)) return <ChartEmpty label={emptyLabel} />
  const config = seriesChartConfig(segments)
  const multiRow = rows.length > 1

  return (
    <div className={cn("w-full space-y-4", className)}>
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: data.length * 40 + 8 }}
      >
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 4, left: 4, bottom: 4 }} barCategoryGap={8}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="label"
            hide={!multiRow}
            tickLine={false}
            axisLine={false}
            width={multiRow ? 44 : 0}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => {
                  const key = String(name)
                  const amount = Number(item.payload?.[`${ABS_PREFIX}${key}`] ?? 0)
                  return (
                    <div className="flex w-full min-w-40 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: typeof item.color === "string" ? item.color : undefined }}
                      />
                      <span className="text-muted-foreground">{config[key]?.label ?? key}</span>
                      <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">
                        {formatChartValue(Number(value), { kind: "percent" })} · {formatChartValue(amount, valueFormat)}
                      </span>
                    </div>
                  )
                }}
              />
            }
          />
          {segments.map((segment, index) => (
            <Bar
              key={segment.key}
              dataKey={segment.key}
              stackId="share"
              fill={seriesColor(segment, index)}
              radius={
                index === 0 ? [6, 0, 0, 6] : index === segments.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]
              }
            />
          ))}
        </BarChart>
      </ChartContainer>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Segment</th>
                {data.map((row) => (
                  <th key={row.label} className="py-1.5 pl-3 text-right font-medium" colSpan={multiRow ? 1 : 2}>
                    {multiRow ? row.label : "Amount"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {segments.map((segment, index) => (
                <tr key={segment.key} className="border-t border-border/60">
                  <td className="py-1.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: seriesColor(segment, index) }}
                      />
                      <span className="truncate">{segment.label}</span>
                    </span>
                  </td>
                  {data.map((row) => {
                    const amount = Number(row[`${ABS_PREFIX}${segment.key}`] ?? 0)
                    const share = formatChartValue(Number(row[segment.key] ?? 0), { kind: "percent" })
                    return multiRow ? (
                      <td key={row.label} className="py-1.5 pl-3 text-right tabular-nums">
                        {formatChartValue(amount, valueFormat)}
                        <span className="ml-1.5 text-xs text-muted-foreground">{share}</span>
                      </td>
                    ) : (
                      [
                        <td key={`${row.label}-amount`} className="py-1.5 pl-3 text-right tabular-nums">
                          {formatChartValue(amount, valueFormat)}
                        </td>,
                        <td key={`${row.label}-share`} className="w-16 py-1.5 pl-3 text-right text-xs tabular-nums text-muted-foreground">
                          {share}
                        </td>,
                      ]
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {segments.map((segment, index) => (
            <span key={segment.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: seriesColor(segment, index) }} />
              {segment.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
