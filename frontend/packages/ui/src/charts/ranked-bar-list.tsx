"use client"

import { useCurrencyFormat } from "../lib/currency-context"
import { cn } from "../lib/utils"
import { TrendBadge } from "../components/trend-badge"
import { chartColor, formatChartValue, type ChartValueFormat } from "../lib/chart-format"
import { ChartEmpty } from "./chart-kit"

export interface RankedBarItem {
  label: string
  value: number
  /** Percent change vs the previous period; omitted when there is nothing to compare. */
  change?: number
  /** Secondary line under the label, e.g. "12 invoices". */
  hint?: string
}

export interface RankedBarListProps {
  items: RankedBarItem[]
  valueFormat?: ChartValueFormat
  /** Rows shown, largest first. Defaults to 6. */
  maxItems?: number
  color?: string
  changeLabel?: string
  emptyLabel?: string
  onItemClick?: (label: string) => void
  className?: string
}

/** Largest first, top `maxItems`; non-positive values are dropped. */
export function rankItems(items: readonly RankedBarItem[], maxItems = 6): RankedBarItem[] {
  return items
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems)
}

/** Horizontal bars ranked by value with a ±% badge — top customers, expense categories. */
export function RankedBarList({
  items,
  valueFormat,
  maxItems = 6,
  color = chartColor(0),
  changeLabel = "",
  emptyLabel,
  onItemClick,
  className,
}: RankedBarListProps) {
  const { locale } = useCurrencyFormat()
  const ranked = rankItems(items, maxItems)
  if (ranked.length === 0) return <ChartEmpty label={emptyLabel} />
  const max = ranked[0]!.value

  return (
    <ol className={cn("space-y-3", className)}>
      {ranked.map((item) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                {item.hint ? <p className="truncate text-xs text-muted-foreground">{item.hint}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatChartValue(item.value, valueFormat, locale)}
                </span>
                {item.change !== undefined ? (
                  <span className="[&>div]:mt-0">
                    <TrendBadge change={item.change} label={changeLabel} />
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
          </>
        )
        return (
          <li key={item.label}>
            {onItemClick ? (
              <button
                type="button"
                className="w-full rounded-md text-left transition-opacity hover:opacity-80"
                onClick={() => onItemClick(item.label)}
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ol>
  )
}
