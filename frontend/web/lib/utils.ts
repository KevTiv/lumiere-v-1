import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Group an array by a key selector, returning a Record<string, T[]> */
export function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const key = keyFn(item)
    ;(acc[key] ??= []).push(item)
    return acc
  }, {})
}

/** Returns the last N month short labels ending at current month e.g. ['Oct','Nov','Dec','Jan','Feb','Mar'] */
export function lastNMonthLabels(n: number): string[] {
  const labels: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    labels.push(d.toLocaleString('en', { month: 'short' }))
  }
  return labels
}

/**
 * Groups records with a numeric timestamp field by month label (last N months).
 * Returns an array of `{ month, [seriesKey]: sumValue }` for use in area/bar charts.
 */
export function groupByMonth<T>(
  items: T[],
  getTimestampMs: (item: T) => number,
  getValue: (item: T) => number,
  seriesKey: string,
  months = 6,
): Record<string, number | string>[] {
  const labels = lastNMonthLabels(months)
  const sums: Record<string, number> = {}
  for (const label of labels) sums[label] = 0

  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1).getTime()

  for (const item of items) {
    const ms = getTimestampMs(item)
    if (ms < cutoff) continue
    const d = new Date(ms)
    const label = d.toLocaleString('en', { month: 'short' })
    if (label in sums) sums[label] += getValue(item)
  }

  return labels.map((month) => ({ month, [seriesKey]: sums[month] }))
}
