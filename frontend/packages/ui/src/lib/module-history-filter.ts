import {
  historyPeriodDates,
  isHistoryDate,
  isHistoryTimestampInRange,
  parseHistoryPeriod,
  resolveHistoryPeriod,
  type HistoryBounds,
  type HistoryDates,
  type HistoryPeriod,
} from "@lumiere/erp-shared/history-period"

/** The overview and its list drilldown must use the same admitted business date field. */
export const MODULE_HISTORY_FIELDS = {
  sales: { tabId: "orders", dateField: "dateOrder" },
  purchasing: { tabId: "orders", dateField: "dateOrder" },
  crm: { tabId: "opportunities", dateField: "createdAt" },
  expenses: { tabId: "expense-sheets", dateField: "createdAt" },
  reports: { tabId: "reports", dateField: "createDate" },
} as const

export type ModuleHistoryModule = keyof typeof MODULE_HISTORY_FIELDS
export type ModuleHistoryField = (typeof MODULE_HISTORY_FIELDS)[ModuleHistoryModule]

/** The only source fields a period drilldown reads, in SDK and HTTP spellings. */
export interface HistoryDatedRecord {
  dateOrder?: unknown
  date_order?: unknown
  createdAt?: unknown
  created_at?: unknown
  createDate?: unknown
  create_date?: unknown
}

const historyDateAliases = { dateOrder: "date_order", createdAt: "created_at", createDate: "create_date" } as const

/** Preserve an explicitly unknown canonical date instead of falling back to a second field. */
export function moduleHistoryDateValue(row: HistoryDatedRecord, key: ModuleHistoryField["dateField"]): unknown {
  const alias = historyDateAliases[key]
  return Object.hasOwn(row, key) ? row[key] : Object.hasOwn(row, alias) ? row[alias] : undefined
}

interface HistoryMicrosTimestamp {
  microsSinceUnixEpoch?: unknown
  micros_since_unix_epoch?: unknown
  __timestamp_micros_since_unix_epoch__?: unknown
}

const microsKeys = ["microsSinceUnixEpoch", "micros_since_unix_epoch", "__timestamp_micros_since_unix_epoch__"] as const

export function getModuleHistoryField(moduleId: string, tabId: string): ModuleHistoryField | null {
  if (!Object.hasOwn(MODULE_HISTORY_FIELDS, moduleId)) return null
  const field = MODULE_HISTORY_FIELDS[moduleId as ModuleHistoryModule]
  return field.tabId === tabId ? field : null
}

function validMillis(ms: number): number | null {
  return Number.isFinite(ms) && Math.abs(ms) <= 8_640_000_000_000_000 ? ms : null
}

function numericMillis(value: unknown, unit: "milliseconds" | "microseconds"): number | null {
  if (typeof value !== "number" && typeof value !== "bigint" &&
      !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))) return null
  if (unit === "microseconds" && ((typeof value === "number" && !Number.isSafeInteger(value)) ||
      (typeof value === "string" && !/^-?\d+$/.test(value)))) return null
  return validMillis(Number(value) / (unit === "microseconds" ? 1000 : 1))
}

/**
 * Exact representation adapters, including negative/epoch timestamps. Bare numeric values are
 * milliseconds unless their producer explicitly declares microseconds; magnitude is not a unit.
 * Date-only values belong to the selected company calendar, not the viewer's browser zone.
 */
export function moduleHistoryTimestampMs(
  value: unknown,
  timeZone = "UTC",
  numericUnit: "milliseconds" | "microseconds" = "milliseconds",
): number | null {
  if (value != null && typeof value === "object" && Object.hasOwn(value, "some")) {
    value = (value as { some: unknown }).some
  }
  if (value instanceof Date) return validMillis(value.getTime())
  if (value != null && typeof value === "object") {
    const row = value as HistoryMicrosTimestamp
    const key = microsKeys.find((candidate) => Object.hasOwn(row, candidate))
    return key ? numericMillis(row[key], "microseconds") : null
  }
  if (typeof value === "string" && isHistoryDate(value)) {
    return resolveHistoryPeriod({ kind: "custom", from: value, through: value }, { timeZone }).startMs
  }
  if (typeof value === "string" && value.includes("T")) {
    const iso = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
    return iso && isHistoryDate(iso[1]) ? validMillis(Date.parse(value)) : null
  }
  return numericMillis(value, numericUnit)
}

export type ModuleHistoryFilter =
  | { status: "inactive" }
  | { status: "invalid"; reason: "invalid-period" | "invalid-time-zone" }
  | {
      status: "active"
      period: HistoryPeriod
      bounds: HistoryBounds
      dates: HistoryDates
      timeZone: string
      field: ModuleHistoryField
    }

/** URL parameters select a period/zone only. They can never name the row field to inspect. */
export function resolveModuleHistoryFilter(
  moduleId: string,
  tabId: string,
  rawPeriod: string | null | undefined,
  options: { timeZone?: string; now?: Date } = {},
): ModuleHistoryFilter {
  const field = getModuleHistoryField(moduleId, tabId)
  if (!field || rawPeriod == null) return { status: "inactive" }
  const period = parseHistoryPeriod(rawPeriod)
  if (!period) return { status: "invalid", reason: "invalid-period" }
  const timeZone = options.timeZone ?? "UTC"
  try {
    // Reject offset strings as well as malformed/unknown zones: links carry an IANA zone.
    if (!timeZone || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) throw new RangeError()
    new Intl.DateTimeFormat("en", { timeZone }).format(0)
  } catch {
    return { status: "invalid", reason: "invalid-time-zone" }
  }
  const settings = { ...options, timeZone, now: options.now ?? new Date() }
  return {
    status: "active", period, timeZone, field,
    bounds: resolveHistoryPeriod(period, settings),
    dates: historyPeriodDates(period, settings),
  }
}

/** Invalid links fail closed. An inactive filter preserves the original rows/reference. */
export function filterModuleHistoryRows<T extends HistoryDatedRecord>(rows: T[], filter: ModuleHistoryFilter): T[] {
  if (filter.status === "inactive") return rows
  if (filter.status === "invalid") return []
  return rows.filter((row) => isHistoryTimestampInRange(
    moduleHistoryTimestampMs(moduleHistoryDateValue(row, filter.field.dateField), filter.timeZone), filter.bounds,
  ))
}

/** Clear only the period controls; retain tab, currency, record and other URL filters. */
export function removeModuleHistoryFilter(query: string): string {
  const params = new URLSearchParams(query)
  params.delete("period")
  params.delete("periodTimeZone")
  return params.toString()
}
