import {
  historyPeriodDates,
  isHistoryDate,
  type HistoryPeriod,
} from "@lumiere/erp-shared/history-period"
import type { QueryClient } from "@tanstack/react-query"

export type HistoryReviewState = "needs_review" | "confirmed" | "excluded"
export type HistoryDateMode = "all" | "dated" | "undated" | "invalid"

export interface HistoryScope {
  organizationId: number
  companyId: number
  actorIdentity: string
}

export interface HistoryCounts {
  total: number
  dated: number
  undated: number
  invalid: number
  minDate: string | null
  maxDate: string | null
  states: Record<HistoryReviewState, number>
}

export interface HistoryDataset extends HistoryCounts {
  id: string
  title: string
  targetEntity: string
  sourceFile: string
}

interface HistoryPage {
  organizationId: string
  companyId: string
  snapshot: string
  nextCursor: string | null
}

export interface HistoryCoverage extends HistoryPage {
  complete: boolean
  aggregatesComplete: true
  totals: HistoryCounts
  datasets: HistoryDataset[]
  years: Array<{ year: number; count: number }>
  months: Array<{ month: string; count: number }>
  bucketGranularity: "year" | "month"
  bucketBasis: "observation_start"
}

export interface HistoryRow {
  id: string
  batchId: string
  title: string
  targetEntity: string
  sourceFile: string
  label: string
  source: { file: string; row: number; rowBasis?: string; sha256: string }
  values: Record<string, string | null>
  fields: Array<{ key: string; label: string; sourceValue: string | null }>
  state: HistoryReviewState
  revision: number
  businessDate: {
    precision: "day" | "month" | "year" | "interval" | "undated" | "invalid"
    from: string | null
    toExclusive: string | null
    raw: string | null
    basis: string
  }
  issue: string
}

export interface HistoryRows extends HistoryPage {
  data: HistoryRow[]
}

export interface HistoryFilters {
  batchId: string | null
  period: HistoryPeriod
  timeZone: string
  dateMode: HistoryDateMode
  state: HistoryReviewState | "all"
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
type JsonObject = { [key: string]: JsonValue }

function malformed(): never {
  throw new Error("Source history returned incomplete or invalid data. Refresh to try again.")
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : malformed()
}

function text(value: unknown): string {
  return typeof value === "string" ? value : malformed()
}

function nonempty(value: unknown): string {
  const result = text(value)
  return result.trim() ? result : malformed()
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value)
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : malformed()
}

function id(value: unknown): string {
  const result = text(value)
  return /^[1-9]\d*$/.test(result) ? result : malformed()
}

function date(value: unknown): string | null {
  return value === null ? null : isHistoryDate(value) ? value : malformed()
}

function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : malformed()
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === "string" && options.includes(value as T) ? value as T : malformed()
}

function counts(value: unknown): HistoryCounts {
  const row = object(value)
  const states = object(row.states)
  const result: HistoryCounts = {
    total: count(row.total), dated: count(row.dated), undated: count(row.undated), invalid: count(row.invalid),
    minDate: date(row.minDate), maxDate: date(row.maxDate),
    states: { needs_review: count(states.needs_review), confirmed: count(states.confirmed), excluded: count(states.excluded) },
  }
  if (result.dated + result.undated + result.invalid !== result.total
    || result.states.needs_review + result.states.confirmed + result.states.excluded !== result.total
    || (result.minDate === null) !== (result.maxDate === null)
    || (result.dated === 0) !== (result.minDate === null)
    || (result.minDate !== null && result.maxDate !== null && result.minDate > result.maxDate)) malformed()
  return result
}

function page(value: JsonObject, scope: HistoryScope, snapshot?: string): HistoryPage {
  const organizationId = id(value.organizationId), companyId = id(value.companyId)
  if (organizationId !== String(scope.organizationId) || companyId !== String(scope.companyId)) {
    throw new Error("Source history does not match the selected organization and company.")
  }
  const currentSnapshot = nonempty(value.snapshot)
  if (snapshot !== undefined && snapshot !== currentSnapshot) {
    throw new Error("Source history changed while loading. Refresh to see the current rows.")
  }
  return { organizationId, companyId, snapshot: currentSnapshot, nextCursor: value.nextCursor === null ? null : nonempty(value.nextCursor) }
}

export function parseHistoryCoverage(value: unknown, scope: HistoryScope, snapshot?: string): HistoryCoverage {
  const row = object(value)
  if (row.status !== "available" || row.storage !== "source_review"
    || row.dateBasis !== "source_business_date" || row.aggregatesComplete !== true
    || row.bucketBasis !== "observation_start") malformed()
  const resultPage = page(row, scope, snapshot)
  if (row.complete !== (resultPage.nextCursor === null)) malformed()
  const datasets = array(row.datasets, (value) => {
    const dataset = object(value)
    return { ...counts(dataset), id: id(dataset.id), title: text(dataset.title), targetEntity: nonempty(dataset.targetEntity), sourceFile: text(dataset.sourceFile) }
  })
  if (new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length) malformed()
  return {
    ...resultPage, complete: resultPage.nextCursor === null, aggregatesComplete: true, totals: counts(row.totals), datasets,
    years: array(row.years, (value) => {
      const bucket = object(value), year = count(bucket.year)
      if (year < 1 || year > 9999) malformed()
      return { year, count: count(bucket.count) }
    }),
    months: array(row.months, (value) => {
      const bucket = object(value), month = text(bucket.month)
      if (!isHistoryDate(`${month}-01`)) malformed()
      return { month, count: count(bucket.count) }
    }),
    bucketGranularity: oneOf(row.bucketGranularity, ["year", "month"]),
    bucketBasis: "observation_start",
  }
}

export function parseHistoryRows(value: unknown, scope: HistoryScope, snapshot?: string): HistoryRows {
  const body = object(value)
  if (body.status !== "available" || body.storage !== "source_review") malformed()
  const data = array(body.data, (value): HistoryRow => {
    const row = object(value), source = object(row.source), businessDate = object(row.businessDate)
    const from = date(businessDate.from), toExclusive = date(businessDate.toExclusive)
    const precision = oneOf(businessDate.precision, ["day", "month", "year", "interval", "undated", "invalid"])
    if (precision === "undated" || precision === "invalid") {
      if (from !== null || toExclusive !== null) malformed()
    } else {
      if (from === null || toExclusive === null || from >= toExclusive) malformed()
      if (precision === "day" && shiftHistoryDate(from, 1) !== toExclusive) malformed()
      if (precision === "month" || precision === "year") {
        const expected = historyCalendarPeriod(Number(from.slice(0, 4)), precision === "month" ? Number(from.slice(5, 7)) : undefined)
        if (typeof expected !== "object" || from !== expected.from || shiftHistoryDate(expected.through, 1) !== toExclusive) malformed()
      }
    }
    const fields = array(row.fields, (value) => {
      const field = object(value)
      return { key: nonempty(field.key), label: text(field.label), sourceValue: field.sourceValue == null ? null : text(field.sourceValue) }
    })
    if (new Set(fields.map((field) => field.key)).size !== fields.length) malformed()
    return {
      id: id(row.id), batchId: id(row.batchId), title: text(row.title), targetEntity: nonempty(row.targetEntity),
      sourceFile: text(row.sourceFile), label: text(row.label),
      source: { file: text(source.file), row: count(source.row), sha256: text(source.sha256), ...(source.rowBasis === undefined ? {} : { rowBasis: text(source.rowBasis) }) },
      values: Object.fromEntries(Object.entries(object(row.values)).map(([key, value]) => [key, nullableText(value)])), fields,
      state: oneOf(row.state, ["needs_review", "confirmed", "excluded"]), revision: count(row.revision),
      businessDate: { precision, from, toExclusive, raw: nullableText(businessDate.raw), basis: text(businessDate.basis) }, issue: text(row.issue),
    }
  })
  if (new Set(data.map((row) => row.id)).size !== data.length) malformed()
  return { ...page(body, scope, snapshot), data }
}

function companyParams(companyId: number): URLSearchParams {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Select a valid operating company.")
  return new URLSearchParams({ companyId: String(companyId) })
}

export function historyCoverageUrl(companyId: number, cursor: string | null = null): string {
  const params = companyParams(companyId)
  if (cursor !== null) params.set("cursor", cursor)
  return `/api/history/source/coverage?${params}`
}

/** Source dates are calendar values: do not parse them in the browser's local zone. */
export function shiftHistoryDate(value: string, days: number): string {
  if (!isHistoryDate(value)) throw new Error("Choose a valid calendar date.")
  const result = new Date(`${value}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  const shifted = result.toISOString().slice(0, 10)
  if (!isHistoryDate(shifted)) throw new Error("The selected dates exceed the supported calendar.")
  return shifted
}

export function historyRowsUrl(companyId: number, filters: HistoryFilters, cursor: string | null = null, snapshot?: string): string {
  const params = companyParams(companyId)
  params.set("limit", "50")
  params.set("dateMode", filters.dateMode)
  if (filters.batchId !== null) params.set("batchId", id(filters.batchId))
  if (filters.state !== "all") params.set("state", filters.state)
  if (filters.dateMode !== "undated" && filters.dateMode !== "invalid") {
    const { from, through } = historyPeriodDates(filters.period, { timeZone: filters.timeZone })
    if (from !== null) params.set("from", from)
    // No supported source date occurs after the final four-digit calendar year.
    if (through !== null && through !== "9999-12-31") params.set("toExclusive", shiftHistoryDate(through, 1))
  }
  if (cursor !== null) params.set("cursor", cursor)
  if (snapshot !== undefined) params.set("snapshot", snapshot)
  return `/api/history/source/rows?${params}`
}

export function historyQueryKey(kind: "coverage" | "rows", scope: HistoryScope, filters?: HistoryFilters, snapshot?: string) {
  return ["available-history", kind, historyActorKey(scope.actorIdentity), scope.organizationId, scope.companyId, filters ?? null, snapshot ?? null] as const
}

function historyActorKey(identity: string): string {
  return identity.replace(/^0x/i, "").toLowerCase()
}

/** A review change invalidates every filter/snapshot for this actor and company only. */
export function historyQueryMatchesScope(queryKey: readonly unknown[], scope: HistoryScope): boolean {
  return Boolean(scope.actorIdentity)
    && queryKey[0] === "available-history"
    && (queryKey[1] === "coverage" || queryKey[1] === "rows")
    && typeof queryKey[2] === "string"
    && historyActorKey(queryKey[2]) === historyActorKey(scope.actorIdentity)
    && queryKey[3] === scope.organizationId
    && queryKey[4] === scope.companyId
}

/** Restart at page one: old continuations belong to the pre-decision snapshot. */
export async function resetHistoryQueries(cache: QueryClient, scope: HistoryScope): Promise<void> {
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => historyQueryMatchesScope(query.queryKey, scope) }
  await cache.cancelQueries(filters)
  await cache.resetQueries(filters)
}

/** Keep calendar shortcuts exact, including leap years and historical years. */
export function historyCalendarPeriod(year: number, month?: number): HistoryPeriod {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))) {
    throw new Error("Choose a valid year and month.")
  }
  const yearText = String(year).padStart(4, "0")
  if (month === undefined) return { kind: "custom", from: `${yearText}-01-01`, through: `${yearText}-12-31` }
  const from = `${yearText}-${String(month).padStart(2, "0")}-01`
  const finalDay = new Date(`${from}T00:00:00Z`)
  finalDay.setUTCMonth(finalDay.getUTCMonth() + 1, 0)
  return { kind: "custom", from, through: finalDay.toISOString().slice(0, 10) }
}
