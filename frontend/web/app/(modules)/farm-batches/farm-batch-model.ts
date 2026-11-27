import type { useTranslation } from "@lumiere/i18n"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation"

export const farmBatchPath = "/farm-batches"
export const farmImportPath = "/farm-batches/import"

export function farmImportHref(companyId: string): string {
  if (!farmRecordId(companyId)) throw new Error("Invalid farm company")
  return `${farmImportPath}?companyId=${companyId}#start-import`
}

export function farmSourceReviewHref(companyId: string, source: FarmEvent["source"]): string | undefined {
  const revision = source?.revision
  if (
    !farmRecordId(companyId) ||
    !farmRecordId(source?.reviewBatchId) ||
    !farmRecordId(source?.reviewItemId) ||
    revision === undefined ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > 2_147_483_647
  ) return undefined

  return sourceReviewHistoryHref(companyId, {
    batchId: source.reviewBatchId,
    itemId: source.reviewItemId,
    revision,
  }, farmImportPath)
}

export function farmRecordId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[1-9]\d{0,19}$/.test(value) && parseStrictU64(value) !== undefined
  )
}

export const farmEventLabels = {
  intake: "farmBatches.intake",
  weighIn: "farmBatches.weighIn",
  feedUsage: "farmBatches.feedUsage",
  feedCoverage: "farmBatches.feedCoverage",
  mortality: "farmBatches.mortality",
  transferIn: "farmBatches.transferIn",
  transferOut: "farmBatches.transferOut",
  internalTransfer: "farmBatches.internalTransfer",
  liveSale: "farmBatches.liveSale",
  processing: "farmBatches.processingObservation",
} as const

export type FarmTranslation = ReturnType<typeof useTranslation>["t"]

export type FarmEventKind = keyof typeof farmEventLabels
type CountEventKind = Exclude<FarmEventKind, "weighIn" | "feedUsage" | "feedCoverage" | "processing">
export type FarmEventInput = { businessDate: string } & (
  | { kind: CountEventKind; count: number }
  | { kind: "weighIn"; sampleCount: number; totalWeightKg: number }
  | { kind: "feedUsage"; feedProduct: string; quantityKg: number }
  | { kind: "feedCoverage"; fromExclusive: string }
  | { kind: "processing"; count: number; liveWeightKg?: number; sellableWeightKg?: number }
)

export type FarmEvent = FarmEventInput & {
  id: string
  revision: number
  source?: {
    reviewBatchId?: string
    reviewItemId?: string
    revision?: number
    row?: number
    file?: string
    sheet?: string
  } | null
}

export interface FarmBatchInput {
  reference: string
  species: string
  startDate: string
  location: string
}

export interface FarmBatch extends FarmBatchInput {
  id: string
  revision: number
  liveHeadcount: number
}

export type FarmMetric<T> =
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: string }

export interface FarmMetrics {
  asOf: string
  recordedDeaths: number
  growthWindow?: {
    openingDate: string
    closingDate: string
    openingSampleCount: number
    closingSampleCount: number
    openingMeanWeightKg: number
    closingMeanWeightKg: number
  } | null
  liveHeadcount: FarmMetric<number>
  mortalityRate: FarmMetric<number>
  averageDailyGainKg: FarmMetric<number>
  feedConversionRatio: FarmMetric<number>
  processingLiveInputKg: FarmMetric<number>
  processingSellableOutputKg: FarmMetric<number>
  processingYield: FarmMetric<number>
  costPerSellableKg: FarmMetric<{ currency: string; minorUnitDigits: number; amountMinorPerKg: number }>
  margin: FarmMetric<{ currency: string; minorUnitDigits: number; amountMinor: string }>
}

export interface FarmBatchDetail extends FarmBatch {
  asOf: string
  events: FarmEvent[]
  metrics?: FarmMetrics
}

export const farmDetailViews = ["overview", "processing", "costs", "metrics", "history"] as const
export type FarmDetailView = (typeof farmDetailViews)[number]

export function selectedFarmView(value: string | null): FarmDetailView {
  return farmDetailViews.find((view) => view === value) ?? "overview"
}

export function selectedFarmEventKind(value: string | null): FarmEventKind {
  return value && Object.hasOwn(farmEventLabels, value) ? (value as FarmEventKind) : "intake"
}

export function farmDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? undefined : value
}

export function farmDateLabel(value: string, locale: string) {
  if (!farmDate(value)) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00.000Z`),
  )
}

export class FarmApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function farmWrite(method: "POST" | "PATCH", data: object): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }
}

export function farmApiPath(companyId: string, tail = "", query: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...query, companyId })
  return `/api${farmBatchPath}${tail}?${params}`
}

export async function farmResponse<T extends { data: unknown }>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      typeof body?.error === "string"
        ? body.error
        : "Farm Batches could not complete the request. Try again."
    throw new FarmApiError(error, response.status)
  }
  if (body == null || typeof body !== "object" || !("data" in body)) {
    throw new FarmApiError("Farm Batches could not verify the response. Try again.", 502)
  }
  return body as T
}

export async function farmRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return (await farmResponse<{ data: T }>(path, init)).data
}


export function eventSummary(event: FarmEvent, locale: string, t: FarmTranslation) {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format
  switch (event.kind) {
    case "weighIn":
      return t("farmBatches.weighedSummary", {
        sample: format(event.sampleCount),
        mean: format(event.totalWeightKg / event.sampleCount),
      })
    case "feedUsage":
      return `${format(event.quantityKg)} kg · ${event.feedProduct}`
    case "feedCoverage":
      return t("farmBatches.afterDate", { date: farmDateLabel(event.fromExclusive, locale) })
    case "processing":
      return [
        t("farmBatches.animals", { countLabel: format(event.count) }),
        event.liveWeightKg == null ? null : t("farmBatches.liveKg", { value: format(event.liveWeightKg) }),
        event.sellableWeightKg == null ? null : t("farmBatches.sellableKg", { value: format(event.sellableWeightKg) }),
      ]
        .filter(Boolean)
        .join(" · ")
    default:
      return t("farmBatches.animals", { countLabel: format(event.count) })
  }
}
