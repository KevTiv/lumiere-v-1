/** Calendar periods shared by dashboards and the imported-history browser. */
export const HISTORY_PRESETS = ["today", "7d", "30d", "90d", "180d", "ytd", "all"] as const
export type HistoryPreset = (typeof HISTORY_PRESETS)[number]
export type HistoryPeriod = HistoryPreset | { kind: "custom"; from: string; through: string }

/** A null bound is open/unknown, never an invented recent-history limit. End is exclusive. */
export interface HistoryBounds {
  startMs: number | null
  endMs: number | null
}

export interface HistoryDates {
  from: string | null
  through: string | null
}

export interface HistoryPeriodOptions {
  now?: Date
  /** Use the selected company's IANA time zone. UTC is the explicit fallback. */
  timeZone?: string
  /** Authoritative coverage only; a page of loaded rows is not complete coverage. */
  coverage?: HistoryBounds
}

export type HistoryPeriodError = "invalid-period" | "invalid-from" | "invalid-through" | "reversed"
export type HistoryPeriodValidation =
  | { valid: true; period: HistoryPeriod }
  | { valid: false; error: HistoryPeriodError }

const DAY_MS = 86_400_000

function calendarStamp(year: number, month: number, day: number): number {
  // Date.UTC treats years 0–99 as 1900–1999. setUTCFullYear preserves historical years.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime()
}

/** Canonical Gregorian dates accepted by native date inputs and the history API. */
export function isHistoryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number) as [number, number, number]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(calendarStamp(year, month, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

export function validateHistoryPeriod(value: unknown): HistoryPeriodValidation {
  if (typeof value === "string" && HISTORY_PRESETS.includes(value as HistoryPreset)) {
    return { valid: true, period: value as HistoryPreset }
  }
  if (value == null || typeof value !== "object" || !("kind" in value) || value.kind !== "custom") {
    return { valid: false, error: "invalid-period" }
  }
  if (!("from" in value) || !isHistoryDate(value.from)) return { valid: false, error: "invalid-from" }
  if (!("through" in value) || !isHistoryDate(value.through)) return { valid: false, error: "invalid-through" }
  if (value.from > value.through) return { valid: false, error: "reversed" }
  return { valid: true, period: { kind: "custom", from: value.from, through: value.through } }
}

/** URL-safe value; callers should set it through URLSearchParams. */
export function serializeHistoryPeriod(period: HistoryPeriod): string {
  const result = validateHistoryPeriod(period)
  if (!result.valid) throw new RangeError(result.error)
  return typeof result.period === "string"
    ? result.period
    : "custom:" + result.period.from + ":" + result.period.through
}

/** Reject malformed links instead of silently replacing them with a recent period. */
export function parseHistoryPeriod(value: string | null | undefined): HistoryPeriod | null {
  if (!value) return null
  const custom = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(value)
  const result = validateHistoryPeriod(custom ? { kind: "custom", from: custom[1], through: custom[2] } : value)
  return result.valid ? result.period : null
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      era: "short",
    })
    dateFormatters.set(timeZone, formatter)
  }
  return formatter
}

function stampAt(ms: number, formatter: Intl.DateTimeFormat): number {
  // Typed database microseconds can produce fractions. Flooring preserves the date before epoch.
  const parts = formatter.formatToParts(Math.floor(ms))
  const part = (type: string) => parts.find((value) => value.type === type)?.value
  const year = Number(part("year"))
  return calendarStamp(part("era") === "BC" ? 1 - year : year, Number(part("month")), Number(part("day")))
}

function stampFromDate(value: string): number {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number]
  return calendarStamp(year, month, day)
}

function dateFromStamp(stamp: number): string {
  const date = new Date(stamp)
  return String(date.getUTCFullYear()).padStart(4, "0") + "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0")
}

export function historyDateAt(ms: number, timeZone = "UTC"): string {
  if (!Number.isFinite(ms)) throw new RangeError("A finite timestamp is required")
  return dateFromStamp(stampAt(ms, dateFormatter(timeZone)))
}

/** First instant on/after the requested local date, including midnight DST transitions. */
function startOfCalendarDate(stamp: number, formatter: Intl.DateTimeFormat): number {
  if (formatter.resolvedOptions().timeZone === "UTC") return stamp
  // Search by calendar date, not a fixed offset: local days may have 23 or 25 hours.
  // A skipped date (e.g. a date-line change) starts at the next existing local date.
  let low = stamp - 2 * DAY_MS
  let high = stamp + 2 * DAY_MS
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (stampAt(middle, formatter) < stamp) low = middle
    else high = middle
  }
  return high
}

function assertBounds(bounds: HistoryBounds): void {
  if ((bounds.startMs !== null && !Number.isFinite(bounds.startMs)) ||
      (bounds.endMs !== null && !Number.isFinite(bounds.endMs)) ||
      (bounds.startMs !== null && bounds.endMs !== null && bounds.startMs > bounds.endMs)) {
    throw new RangeError("History bounds must be finite or null and ordered")
  }
}

/** Presets include whole company-calendar dates, ending at the next local midnight. */
export function resolveHistoryPeriod(period: HistoryPeriod, options: HistoryPeriodOptions = {}): HistoryBounds {
  const result = validateHistoryPeriod(period)
  if (!result.valid) throw new RangeError(result.error)
  if (period === "all") {
    const bounds = options.coverage ?? { startMs: null, endMs: null }
    assertBounds(bounds)
    return { ...bounds }
  }
  const formatter = dateFormatter(options.timeZone ?? "UTC")
  let startDate: number
  let throughDate: number
  if (typeof period === "object") {
    startDate = stampFromDate(period.from)
    throughDate = stampFromDate(period.through)
  } else {
    const now = (options.now ?? new Date()).getTime()
    if (!Number.isFinite(now)) throw new RangeError("A valid current date is required")
    throughDate = stampAt(now, formatter)
    startDate = period === "ytd"
      ? calendarStamp(new Date(throughDate).getUTCFullYear(), 1, 1)
      : throughDate - ((period === "today" ? 1 : Number(period.slice(0, -1))) - 1) * DAY_MS
  }
  return {
    startMs: startOfCalendarDate(startDate, formatter),
    endMs: startOfCalendarDate(throughDate + DAY_MS, formatter),
  }
}

/** Date-only bounds for source-calendar APIs; custom dates never shift with the viewer's zone. */
export function historyPeriodDates(period: HistoryPeriod, options: HistoryPeriodOptions = {}): HistoryDates {
  const validation = validateHistoryPeriod(period)
  if (!validation.valid) throw new RangeError(validation.error)
  if (typeof period === "object") return { from: period.from, through: period.through }
  const bounds = resolveHistoryPeriod(period, options)
  if (bounds.startMs !== null && bounds.startMs === bounds.endMs) {
    throw new RangeError("An empty timestamp interval has no inclusive calendar date range")
  }
  const timeZone = options.timeZone ?? "UTC"
  return {
    from: bounds.startMs === null ? null : historyDateAt(bounds.startMs, timeZone),
    through: bounds.endMs === null ? null : historyDateAt(Math.ceil(bounds.endMs) - 1, timeZone),
  }
}

/** Timestamp API representation. Open bounds remain null, never Infinity or an invented date. */
export function serializeHistoryBounds(bounds: HistoryBounds): { start: string | null; end: string | null } {
  assertBounds(bounds)
  return {
    start: bounds.startMs === null ? null : new Date(bounds.startMs).toISOString(),
    end: bounds.endMs === null ? null : new Date(bounds.endMs).toISOString(),
  }
}

/** Undated records need a separate filter; even all-history does not turn null into epoch. */
export function isHistoryTimestampInRange(ms: number | null | undefined, bounds: HistoryBounds): boolean {
  return typeof ms === "number" && Number.isFinite(ms) &&
    (bounds.startMs === null || ms >= bounds.startMs) &&
    (bounds.endMs === null || ms < bounds.endMs)
}

/** Open/empty periods cannot be compared. Whole dates compare equal calendar-day counts. */
export function previousHistoryPeriod(bounds: HistoryBounds, timeZone = "UTC"): HistoryBounds | null {
  assertBounds(bounds)
  const { startMs, endMs } = bounds
  if (startMs === null || endMs === null || startMs === endMs) return null
  const formatter = dateFormatter(timeZone)
  const firstDate = stampAt(startMs, formatter)
  const endDate = stampAt(endMs, formatter)
  const wholeDates = startOfCalendarDate(firstDate, formatter) === startMs &&
    startOfCalendarDate(endDate, formatter) === endMs
  return {
    startMs: wholeDates
      ? startOfCalendarDate(firstDate - (endDate - firstDate), formatter)
      : startMs - (endMs - startMs),
    endMs: startMs,
  }
}

export type HistoryBucketUnit = "day" | "week" | "month" | "quarter" | "year"
export interface HistoryBucket {
  key: string
  label: string
  unit: HistoryBucketUnit
  startMs: number
  endMs: number
}

/** Coarsen chart buckets as history grows; never truncate dates to fit a chart. */
export function createHistoryBuckets(
  bounds: HistoryBounds,
  options: { timeZone?: string; locale?: string; maxBuckets?: number } = {},
): HistoryBucket[] {
  assertBounds(bounds)
  const { startMs, endMs } = bounds
  if (startMs === null || endMs === null || startMs === endMs) return []
  const maxBuckets = options.maxBuckets ?? 60
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new RangeError("maxBuckets must be a positive integer")
  const timeZone = options.timeZone ?? "UTC"
  const formatter = dateFormatter(timeZone)
  const first = new Date(stampAt(startMs, formatter))
  const last = new Date(stampAt(Math.ceil(endMs) - 1, formatter))
  const labelFormatter = (unit: HistoryBucketUnit) => new Intl.DateTimeFormat(options.locale ?? "en", {
    timeZone,
    year: "numeric",
    ...(unit === "year" ? {} : { month: "short" as const }),
    ...(unit === "day" || unit === "week" ? { day: "numeric" as const } : {}),
  })
  for (const unit of ["day", "week", "month", "quarter", "year"] as const) {
    const step = unit === "year" ? Math.max(1, Math.ceil((last.getUTCFullYear() - first.getUTCFullYear() + 1) / maxBuckets)) : 1
    let cursor = first.getTime()
    if (unit === "week") cursor -= ((first.getUTCDay() + 6) % 7) * DAY_MS
    if (unit === "month" || unit === "quarter") {
      const month = unit === "quarter" ? Math.floor(first.getUTCMonth() / 3) * 3 : first.getUTCMonth()
      cursor = calendarStamp(first.getUTCFullYear(), month + 1, 1)
    }
    if (unit === "year") cursor = calendarStamp(first.getUTCFullYear(), 1, 1)
    const buckets: HistoryBucket[] = []
    const labels = labelFormatter(unit)
    let bucketStart = startOfCalendarDate(cursor, formatter)
    while (bucketStart < endMs && buckets.length <= maxBuckets) {
      const date = new Date(cursor)
      const next = unit === "day" || unit === "week"
        ? cursor + (unit === "week" ? 7 : 1) * DAY_MS
        : calendarStamp(date.getUTCFullYear() + (unit === "year" ? step : 0),
          date.getUTCMonth() + 1 + (unit === "month" ? 1 : unit === "quarter" ? 3 : 0), 1)
      const bucketEnd = startOfCalendarDate(next, formatter)
      if (bucketEnd > startMs && bucketEnd > bucketStart) {
        const label = unit === "quarter" ? "Q" + (Math.floor(date.getUTCMonth() / 3) + 1) + " " + date.getUTCFullYear()
          : unit === "year" && step > 1 ? date.getUTCFullYear() + "–" + Math.min(last.getUTCFullYear(), date.getUTCFullYear() + step - 1)
            : labels.format(Math.floor(Math.max(startMs, bucketStart)))
        buckets.push({ key: unit + ":" + dateFromStamp(cursor), label, unit,
          startMs: Math.max(startMs, bucketStart), endMs: Math.min(endMs, bucketEnd) })
      }
      cursor = next
      bucketStart = bucketEnd
    }
    if (buckets.length <= maxBuckets) return buckets
  }
  return []
}
