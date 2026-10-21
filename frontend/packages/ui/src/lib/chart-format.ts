/**
 * Shared, pure helpers for the chart kit: value formatting, theme colours and anomaly detection.
 * Formats are data (not functions) so widget configs stay serialisable and CSV export stays plain.
 */

export type ChartValueFormat =
  | { kind: "number" }
  | { kind: "currency"; currency: string }
  | { kind: "percent" }

/** One plotted series: the data key, its legend label and an optional colour (defaults to a theme token). */
export interface ChartSeriesSpec {
  key: string
  label: string
  color?: string
}

/** A row of chart data: the category/x value plus one numeric value per series key. */
export interface ChartDatum {
  [key: string]: string | number
}

const CHART_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const

/** The n-th theme chart colour (`--chart-1..5`, cycling), which flips with light/dark themes. */
export function chartColor(index: number): string {
  return `hsl(var(${CHART_TOKENS[((index % CHART_TOKENS.length) + CHART_TOKENS.length) % CHART_TOKENS.length]}))`
}

function isCurrencyCode(code: string): boolean {
  return /^[A-Za-z]{3}$/.test(code)
}

/** Full-precision value for tooltips and tables. */
export function formatChartValue(value: number, format: ChartValueFormat = { kind: "number" }): string {
  if (!Number.isFinite(value)) return "—"
  if (format.kind === "percent") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`
  }
  if (format.kind === "currency" && isCurrencyCode(format.currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: format.currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(value)
    } catch {
      // unknown ISO code: fall through to a plain number
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
}

/** Short value for axis ticks and dense labels: 1.2k, 3.4M, $12k. */
export function formatChartTick(value: number, format: ChartValueFormat = { kind: "number" }): string {
  if (!Number.isFinite(value)) return ""
  if (format.kind === "percent") return `${Math.round(value)}%`
  const options: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: 1 }
  if (format.kind === "currency" && isCurrencyCode(format.currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        ...options,
        style: "currency",
        currency: format.currency.toUpperCase(),
      }).format(value)
    } catch {
      // unknown ISO code: fall through
    }
  }
  return new Intl.NumberFormat("en-US", options).format(value)
}

/** Value as a share of a total, 0 when the total is empty. */
export function shareOf(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

/**
 * Points that sit far from the series' typical level: more than `threshold` robust z-scores
 * (median absolute deviation) away from the median. Robust so one spike cannot hide another.
 * Needs at least four points; returns the indexes of the outliers.
 */
export function detectAnomalies(values: readonly number[], threshold = 3): number[] {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length < 4) return []
  const median = medianOf(finite)
  const mad = medianOf(finite.map((value) => Math.abs(value - median)))
  if (mad === 0) {
    // Flat series: anything different from the flat level is unusual.
    return values.flatMap((value, index) => (Number.isFinite(value) && value !== median ? [index] : []))
  }
  // 1.4826 scales the MAD to a standard deviation for normally distributed data.
  const scale = 1.4826 * mad
  return values.flatMap((value, index) =>
    Number.isFinite(value) && Math.abs(value - median) / scale > threshold ? [index] : [],
  )
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

/** Month buckets ending at `now`: [{ key: "2026-07", label: "Jul" }, …], oldest first. */
export function monthBuckets(count: number, now: Date = new Date()): Array<{ key: string; label: string; startMs: number; endMs: number }> {
  const buckets: Array<{ key: string; label: string; startMs: number; endMs: number }> = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1)
    buckets.push({
      key: monthKey(start.getTime()),
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(start),
      startMs: start.getTime(),
      endMs: end.getTime() - 1,
    })
  }
  return buckets
}

/** "2026-07" for a timestamp in local time. */
export function monthKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}
