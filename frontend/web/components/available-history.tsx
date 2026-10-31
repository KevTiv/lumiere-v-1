"use client"

import { useId, useState } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { HistoryPeriodSelect } from "@lumiere/ui/components/history-period-select"
import { Button } from "@lumiere/ui/components/button"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lumiere/ui/components/table"
import { apiFetch } from "../lib/api-fetch"
import {
  historyCalendarPeriod,
  historyCoverageUrl,
  historyQueryKey,
  historyRowsUrl,
  parseHistoryCoverage,
  parseHistoryRows,
  resetHistoryQueries,
  shiftHistoryDate,
  type HistoryDateMode,
  type HistoryFilters,
  type HistoryReviewState,
  type HistoryRow,
  type HistoryScope,
} from "../lib/history-data"

type PageCursor = { cursor: string | null; snapshot?: string }
type Props = HistoryScope & { timeZone?: string }

async function readHistory<T>(url: string, parse: (value: unknown) => T, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Source history is restricted for this session or company.")
    }
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Source history is temporarily unavailable. Try again."
    throw new Error(message)
  }
  return parse(body)
}

/** Settings host: source history always uses the current authenticated actor and company. */
export function CompanyAvailableHistory({ organizationId, timeZone }: { organizationId: number; timeZone?: string }) {
  const companyId = useOperatingCompanyId(organizationId)
  const { identity, organizationId: sessionOrganizationId, activeCompanyReady } = useErpSession()
  const { t } = useTranslation()
  if (!activeCompanyReady) return <p role="status">{t("availableHistory.loadingCompany", { defaultValue: "Loading the current company…" })}</p>
  if (!companyId || !identity || sessionOrganizationId !== organizationId) return <p>{t("availableHistory.companyRequired", { defaultValue: "Select an operating company to inspect its history." })}</p>
  return <AvailableHistory organizationId={organizationId} companyId={companyId} actorIdentity={identity} timeZone={timeZone} />
}

export function AvailableHistory(props: Props) {
  return <ScopedAvailableHistory key={`${props.actorIdentity}:${props.organizationId}:${props.companyId}:${props.timeZone ?? "UTC"}`} {...props} />
}

function ScopedAvailableHistory({ organizationId, companyId, actorIdentity, timeZone = "UTC" }: Props) {
  const { t, i18n } = useTranslation()
  const cache = useQueryClient()
  const controlId = useId()
  const scope: HistoryScope = { organizationId, companyId, actorIdentity }
  const [filters, setFilters] = useState<HistoryFilters>({ batchId: null, period: "all", timeZone, dateMode: "all", state: "all" })
  const enabled = Number.isSafeInteger(organizationId) && organizationId > 0 && Number.isSafeInteger(companyId) && companyId > 0 && actorIdentity.length > 0
  const coverageQuery = useInfiniteQuery({
    queryKey: historyQueryKey("coverage", scope),
    initialPageParam: { cursor: null } as PageCursor,
    queryFn: ({ pageParam, signal }) => readHistory(historyCoverageUrl(companyId, pageParam.cursor), (value) => parseHistoryCoverage(value, scope, pageParam.snapshot), signal),
    getNextPageParam: (lastPage, pages): PageCursor | undefined => lastPage.nextCursor ? { cursor: lastPage.nextCursor, snapshot: pages[0]?.snapshot } : undefined,
    enabled, retry: false, staleTime: 0, refetchOnMount: "always",
  })
  const coverage = coverageQuery.data?.pages[0]
  const rowsQuery = useInfiniteQuery({
    queryKey: historyQueryKey("rows", scope, filters, coverage?.snapshot),
    initialPageParam: { cursor: null } as PageCursor,
    queryFn: ({ pageParam, signal }) => readHistory(historyRowsUrl(companyId, filters, pageParam.cursor, coverage?.snapshot), (value) => parseHistoryRows(value, scope, pageParam.snapshot ?? coverage?.snapshot), signal),
    getNextPageParam: (lastPage, pages): PageCursor | undefined => lastPage.nextCursor ? { cursor: lastPage.nextCursor, snapshot: pages[0]?.snapshot } : undefined,
    enabled: enabled && Boolean(coverage) && !coverageQuery.isError && (!coverageQuery.isFetching || coverageQuery.isFetchingNextPage), retry: false, staleTime: 0, refetchOnMount: "always",
  })
  const datasets = coverageQuery.data?.pages.flatMap((page) => page.datasets) ?? []
  const rows = rowsQuery.data?.pages.flatMap((page) => page.data) ?? []
  // Cached data stays hidden until the current scope has been revalidated.
  const coverageLoading = coverageQuery.isPending || (coverageQuery.isFetching && !coverageQuery.isFetchingNextPage)
  const rowsLoading = rowsQuery.isPending || (rowsQuery.isFetching && !rowsQuery.isFetchingNextPage)
  const coverageMismatch = coverageQuery.data?.pages.some((page) => page.snapshot !== coverage?.snapshot)
    || new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length
  const rowsMismatch = rowsQuery.data?.pages.some((page) => page.snapshot !== rowsQuery.data?.pages[0]?.snapshot)
    || new Set(rows.map((row) => row.id)).size !== rows.length
  const changedMessage = t("availableHistory.changed", { defaultValue: "Source history changed while loading. Refresh to see the current rows." })
  const coverageError = coverageQuery.error?.message ?? (coverageMismatch ? changedMessage : null)
  const rowsError = rowsQuery.error?.message ?? (rowsMismatch ? changedMessage : null)
  const stateLabel = (state: HistoryReviewState) => ({
    needs_review: t("availableHistory.needsReview", { defaultValue: "Needs review" }),
    confirmed: t("availableHistory.confirmed", { defaultValue: "Confirmed source" }),
    excluded: t("availableHistory.excluded", { defaultValue: "Excluded" }),
  })[state]
  const dateLabel = (value: string | null) => value === null ? t("availableHistory.noDate", { defaultValue: "No known date" }) : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
  const rangeLabel = (from: string | null, through: string | null) => from === through ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(through)}`
  const period = filters.period
  const selectedYear = typeof period === "object" && period.from.slice(0, 4) === period.through.slice(0, 4) ? period.from.slice(0, 4) : "__none__"
  const selectedMonth = typeof period === "object" && period.from.slice(0, 7) === period.through.slice(0, 7) ? String(Number(period.from.slice(5, 7))) : "__none__"
  const undatedOnly = filters.dateMode === "undated" || filters.dateMode === "invalid"
  const refresh = () => { void resetHistoryQueries(cache, scope) }
  const errorNotice = (message: string) => <Alert variant="destructive" role="alert"><AlertTitle>{t("availableHistory.unavailable", { defaultValue: "History could not be loaded" })}</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>
  const setFilter = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => setFilters((current) => ({ ...current, [key]: value }))

  return <section className="min-w-0 space-y-5" aria-label={t("availableHistory.title", { defaultValue: "Available source history" })}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold">{t("availableHistory.title", { defaultValue: "Available source history" })}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("availableHistory.description", { defaultValue: "Inspect dates, original rows and review decisions from your onboarding files. Confirmed source values still need their business import before they appear in sales, expenses or stock balances." })}</p>
      </div>
      <Button variant="outline" onClick={refresh} disabled={!enabled || coverageQuery.isFetching || rowsQuery.isFetching}>{t("common.refresh", { defaultValue: "Refresh" })}</Button>
    </div>
    {!enabled ? <p role="status">{t("availableHistory.companyRequired", { defaultValue: "Select an operating company to inspect its history." })}</p> : <>
      {coverageLoading ? <p role="status">{t("availableHistory.loadingCoverage", { defaultValue: "Loading available dates…" })}</p> : coverageError ? errorNotice(coverageError) : coverage ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t("availableHistory.savedRows", { defaultValue: "Saved source rows" }), coverage.totals.total],
            [stateLabel("needs_review"), coverage.totals.states.needs_review],
            [stateLabel("confirmed"), coverage.totals.states.confirmed],
            [stateLabel("excluded"), coverage.totals.states.excluded],
          ].map(([label, count]) => <div className="rounded-lg border p-3" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{count}</p></div>)}
        </div>
        <div className="space-y-1 text-sm">
          <p>{t("availableHistory.coverage", { defaultValue: "Known business dates" })}: <strong>{rangeLabel(coverage.totals.minDate, coverage.totals.maxDate)}</strong></p>
          <p className="text-muted-foreground">{t("availableHistory.dateCounts", { defaultValue: "{{dated}} dated · {{undated}} undated · {{invalid}} invalid or ambiguous dates", dated: coverage.totals.dated, undated: coverage.totals.undated, invalid: coverage.totals.invalid })}</p>
          <p className="text-xs text-muted-foreground">{t("availableHistory.calendarDates", { defaultValue: "Source dates retain their calendar day. Upload dates do not replace unknown business dates. A gap means no dated source was found; it does not establish a zero balance." })}</p>
          <p className="text-xs text-muted-foreground">{t("availableHistory.bucketMeaning", { defaultValue: "Year and month counts use each observation's starting date. Period observations are counted once. Coverage describes all saved source rows for this company." })}</p>
        </div>
        {coverage.totals.total === 0 && datasets.length === 0 ? <p role="status" className="rounded-lg border p-4 text-sm">{t("availableHistory.empty", { defaultValue: "No saved source history is available for this company yet. Load a review document or save an import preview below." })}</p> : <details className="rounded-lg border p-3" open>
          <summary className="cursor-pointer font-medium">{t("availableHistory.datasets", { defaultValue: "Source datasets" })}</summary>
          <Table><TableHeader><TableRow>
            <TableHead>{t("availableHistory.dataset", { defaultValue: "Dataset" })}</TableHead>
            <TableHead>{t("availableHistory.coverage", { defaultValue: "Known business dates" })}</TableHead>
            <TableHead>{t("availableHistory.rows", { defaultValue: "Rows" })}</TableHead>
            <TableHead>{stateLabel("needs_review")}</TableHead>
            <TableHead>{stateLabel("confirmed")}</TableHead>
            <TableHead>{stateLabel("excluded")}</TableHead>
            <TableHead>{t("availableHistory.undated", { defaultValue: "Undated" })}</TableHead>
            <TableHead><span className="sr-only">{t("availableHistory.inspect", { defaultValue: "Inspect rows" })}</span></TableHead>
          </TableRow></TableHeader><TableBody>{datasets.map((dataset) => <TableRow key={dataset.id}>
            <TableCell className="max-w-sm whitespace-normal break-words"><p className="font-medium">{dataset.title}</p><p className="text-xs text-muted-foreground">{dataset.sourceFile}</p></TableCell>
            <TableCell className="whitespace-normal">{rangeLabel(dataset.minDate, dataset.maxDate)}</TableCell>
            <TableCell>{dataset.total}</TableCell><TableCell>{dataset.states.needs_review}</TableCell><TableCell>{dataset.states.confirmed}</TableCell><TableCell>{dataset.states.excluded}</TableCell><TableCell>{dataset.undated}</TableCell>
            <TableCell><Button size="sm" variant={filters.batchId === dataset.id ? "secondary" : "outline"} aria-pressed={filters.batchId === dataset.id} onClick={() => setFilter("batchId", dataset.id)}>{t("availableHistory.inspect", { defaultValue: "Inspect rows" })}</Button></TableCell>
          </TableRow>)}</TableBody></Table>
          {coverageQuery.hasNextPage ? <Button variant="outline" className="mt-3" disabled={coverageQuery.isFetchingNextPage} onClick={() => void coverageQuery.fetchNextPage()}>{t("availableHistory.moreDatasets", { defaultValue: "Load more datasets" })}</Button> : null}
        </details>}
      </> : null}

      {!coverageError ? <div className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0 sm:col-span-2 xl:col-span-3"><HistoryPeriodSelect value={filters.period} onChange={(value) => setFilter("period", value)} timeZone={timeZone} coverageDates={coverage && !coverageError && !coverageLoading ? { from: coverage.totals.minDate, through: coverage.totals.maxDate } : undefined} disabled={undatedOnly} /></div>
        <label className="min-w-0 space-y-1 text-sm" htmlFor={`${controlId}-dataset`}><span>{t("availableHistory.dataset", { defaultValue: "Dataset" })}</span><Select value={filters.batchId ?? "__all__"} onValueChange={(value) => setFilter("batchId", value === "__all__" ? null : value)}>
          <SelectTrigger id={`${controlId}-dataset`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">{t("availableHistory.allDatasets", { defaultValue: "All saved datasets" })}</SelectItem>{!coverageLoading && !coverageError ? datasets.map((dataset) => <SelectItem key={dataset.id} value={dataset.id}>{dataset.title}</SelectItem>) : null}</SelectContent>
        </Select></label>
        <label className="min-w-0 space-y-1 text-sm" htmlFor={`${controlId}-date-state`}><span>{t("availableHistory.dateState", { defaultValue: "Date quality" })}</span><Select value={filters.dateMode} onValueChange={(value) => setFilter("dateMode", value as HistoryDateMode)}>
          <SelectTrigger id={`${controlId}-date-state`}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("availableHistory.allDates", { defaultValue: "All date states" })}</SelectItem>
            <SelectItem value="dated">{t("availableHistory.dated", { defaultValue: "Known dates" })}</SelectItem>
            <SelectItem value="undated">{t("availableHistory.undated", { defaultValue: "Undated" })}</SelectItem>
            <SelectItem value="invalid">{t("availableHistory.invalid", { defaultValue: "Invalid or ambiguous dates" })}</SelectItem>
          </SelectContent>
        </Select></label>
        <label className="min-w-0 space-y-1 text-sm" htmlFor={`${controlId}-review-state`}><span>{t("availableHistory.reviewState", { defaultValue: "Review status" })}</span><Select value={filters.state} onValueChange={(value) => setFilter("state", value as HistoryReviewState | "all")}>
          <SelectTrigger id={`${controlId}-review-state`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("availableHistory.allReviews", { defaultValue: "All review states" })}</SelectItem>{(["needs_review", "confirmed", "excluded"] as const).map((state) => <SelectItem key={state} value={state}>{stateLabel(state)}</SelectItem>)}</SelectContent>
        </Select></label>
        {!coverageLoading && !coverageError && coverage?.years.length ? <>
          <label className="min-w-0 space-y-1 text-sm" htmlFor={`${controlId}-year`}><span>{t("availableHistory.year", { defaultValue: "Jump to year" })}</span><Select value={selectedYear} disabled={undatedOnly} onValueChange={(value) => { if (value !== "__none__") setFilter("period", historyCalendarPeriod(Number(value))) }}>
            <SelectTrigger id={`${controlId}-year`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{t("availableHistory.chooseYear", { defaultValue: "Choose an available year" })}</SelectItem>{[...coverage.years].sort((a, b) => b.year - a.year).map((bucket) => <SelectItem key={bucket.year} value={String(bucket.year).padStart(4, "0")}>{bucket.year} ({bucket.count})</SelectItem>)}</SelectContent>
          </Select></label>
          <label className="min-w-0 space-y-1 text-sm" htmlFor={`${controlId}-month`}><span>{t("availableHistory.month", { defaultValue: "Jump to month" })}</span><Select value={selectedMonth} disabled={undatedOnly || selectedYear === "__none__"} onValueChange={(value) => { if (value !== "__none__") setFilter("period", historyCalendarPeriod(Number(selectedYear), Number(value))) }}>
            <SelectTrigger id={`${controlId}-month`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{t("availableHistory.chooseMonth", { defaultValue: "Choose a month" })}</SelectItem>{Array.from({ length: 12 }, (_, index) => {
              const bucket = coverage.months.find((item) => item.month === `${selectedYear}-${String(index + 1).padStart(2, "0")}`)
              return <SelectItem key={index} value={String(index + 1)}>{new Intl.DateTimeFormat(i18n.language, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1)))}{bucket ? ` (${bucket.count})` : ""}</SelectItem>
            })}</SelectContent>
          </Select></label>
        </> : null}
        <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">{undatedOnly ? t("availableHistory.unknownRange", { defaultValue: "Rows without a usable business date are shown across all source history." }) : t("availableHistory.rangeHint", { defaultValue: "A selected date range includes dated rows that overlap it. Use Undated or Invalid dates to inspect rows without a usable date." })}</p>
      </div> : null}

      {coverageError ? null : coverageLoading || rowsLoading ? <p role="status">{t("availableHistory.loadingRows", { defaultValue: "Loading source rows…" })}</p> : rowsError ? errorNotice(rowsError) : rowsQuery.data ? <div className="space-y-3">
        <h3 className="font-medium">{t("availableHistory.loadedRows", { defaultValue: "{{count}} source rows loaded", count: rows.length })}</h3>
        {!rows.length ? <p role="status" className="text-sm text-muted-foreground">{t("availableHistory.noMatches", { defaultValue: "No saved source rows match these filters." })}</p> : <Table><TableHeader><TableRow>
          <TableHead>{t("availableHistory.businessDate", { defaultValue: "Business date" })}</TableHead><TableHead>{t("availableHistory.item", { defaultValue: "Item" })}</TableHead><TableHead>{t("availableHistory.reviewState", { defaultValue: "Review status" })}</TableHead><TableHead>{t("availableHistory.source", { defaultValue: "Source" })}</TableHead><TableHead>{t("availableHistory.interpretation", { defaultValue: "Interpretation" })}</TableHead>
        </TableRow></TableHeader><TableBody>{rows.map((row) => <HistoryRowView key={row.id} row={row} stateLabel={stateLabel(row.state)} dateLabel={dateLabel} />)}</TableBody></Table>}
        {rowsQuery.hasNextPage ? <Button variant="outline" disabled={rowsQuery.isFetchingNextPage} onClick={() => void rowsQuery.fetchNextPage()}>{t("availableHistory.moreRows", { defaultValue: "Load more rows" })}</Button> : null}
      </div> : null}
    </>}
  </section>
}

function HistoryRowView({ row, stateLabel, dateLabel }: { row: HistoryRow; stateLabel: string; dateLabel: (value: string | null) => string }) {
  const { t } = useTranslation()
  const businessDate = row.businessDate
  const dateText = businessDate.from !== null && businessDate.toExclusive !== null
    ? businessDate.precision === "day" ? dateLabel(businessDate.from) : `${dateLabel(businessDate.from)} – ${dateLabel(shiftHistoryDate(businessDate.toExclusive, -1))}`
    : businessDate.precision === "invalid" ? t("availableHistory.invalid", { defaultValue: "Invalid or ambiguous dates" }) : t("availableHistory.undated", { defaultValue: "Undated" })
  const fields = [...row.fields, ...Object.keys(row.values).filter((key) => !row.fields.some((field) => field.key === key)).map((key) => ({ key, label: key, sourceValue: null }))]
  const unknown = t("availableHistory.unknown", { defaultValue: "Unknown" })
  return <TableRow>
    <TableCell className="whitespace-normal"><p>{dateText}</p>{businessDate.raw ? <p className="mt-1 max-w-xs break-words text-xs text-muted-foreground">{businessDate.raw}</p> : null}</TableCell>
    <TableCell className="max-w-sm whitespace-normal break-words"><p className="font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{row.title}</p></TableCell>
    <TableCell className="whitespace-normal">{stateLabel}</TableCell>
    <TableCell className="max-w-xs whitespace-normal break-words">{row.source.file}<span className="block text-xs text-muted-foreground">{t(row.source.rowBasis === "import_row" ? "availableHistory.importRow" : "availableHistory.sourceRow", { defaultValue: row.source.rowBasis === "import_row" ? "Import row {{row}}" : "Source row {{row}}", row: row.source.row })}</span></TableCell>
    <TableCell className="max-w-lg whitespace-normal"><details><summary className="cursor-pointer text-sm font-medium">{t("availableHistory.inspectValues", { defaultValue: "Inspect source and values" })}</summary><div className="mt-3 space-y-3">
      {row.issue ? <p className="text-sm text-muted-foreground">{row.issue}</p> : null}
      <Table><TableHeader><TableRow><TableHead>{t("availableHistory.field", { defaultValue: "Field" })}</TableHead><TableHead>{t("availableHistory.original", { defaultValue: "Original source" })}</TableHead><TableHead>{t("availableHistory.current", { defaultValue: "Current interpretation" })}</TableHead></TableRow></TableHeader><TableBody>{fields.map((field) => <TableRow key={field.key}><TableCell>{field.label}</TableCell><TableCell className="max-w-xs whitespace-normal break-words">{field.sourceValue ?? unknown}</TableCell><TableCell className="max-w-xs whitespace-normal break-words">{row.values[field.key] ?? unknown}</TableCell></TableRow>)}</TableBody></Table>
      <p className="text-xs text-muted-foreground">{t("availableHistory.revision", { defaultValue: "Review revision {{revision}}", revision: row.revision })}</p>
    </div></details></TableCell>
  </TableRow>
}
