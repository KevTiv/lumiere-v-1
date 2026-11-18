import { z } from "zod"
import { parseAssistantActionId } from "@lumiere/query-hooks/assistant-actions"
import { isHistoryDate } from "@lumiere/erp-shared/history-period"

type NumberFormat = (value: number) => string

function metric<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value }),
    z.object({ status: z.literal("unavailable"), reason: z.string() }),
  ])
}

const numericMetric = metric(z.number().finite())
const monetaryBasis = {
  currency: z.string().regex(/^[A-Z]{3}$/),
  minorUnitDigits: z.number().int().min(0).max(9),
}
const farmResponse = z.object({
  data: z.object({
    id: z.string(),
    reference: z.string().optional(),
    metrics: z.object({
      asOf: z.string().refine(isHistoryDate),
      recordedDeaths: z.number().int().nonnegative(),
      liveHeadcount: numericMetric,
      mortalityRate: numericMetric,
      averageDailyGainKg: numericMetric,
      feedConversionRatio: numericMetric,
      processingYield: numericMetric,
      costPerSellableKg: metric(z.object({ ...monetaryBasis, amountMinorPerKg: z.number().finite() })),
      margin: metric(z.object({ ...monetaryBasis, amountMinor: z.string().regex(/^-?\d+$/) })),
    }),
  }),
})

function formatMinorUnits(
  amount: bigint,
  currency: string,
  digits: number,
): string {
  const absolute = (amount < 0n ? -amount : amount).toString().padStart(digits + 1, "0")
  const major = digits ? absolute.slice(0, -digits) : absolute
  const fraction = digits ? `.${absolute.slice(-digits)}` : ""
  return `${amount < 0n ? "−" : ""}${major}${fraction} ${currency}`
}

function verifiedFarmMetrics(payload: unknown, batchId: string, locale: string) {
  const result = farmResponse.safeParse(payload)
  if (!result.success || result.data.data.id !== batchId) return undefined
  const { metrics } = result.data.data
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 })
  const measurement = (value: z.infer<typeof numericMetric>, format: NumberFormat) =>
    value.status === "available" ? format(value.value) : "Insufficient records"
  const cost = metrics.costPerSellableKg.status === "available" ? metrics.costPerSellableKg.value : undefined
  const margin = metrics.margin.status === "available" ? metrics.margin.value : undefined
  const content = [
    `**Farm batch #${batchId} · ${metrics.asOf}**`,
    "",
    `- Live headcount — ${measurement(metrics.liveHeadcount, number.format)}`,
    `- Recorded deaths — ${number.format(metrics.recordedDeaths)}`,
    `- Mortality rate — ${measurement(metrics.mortalityRate, percent.format)}`,
    `- Average daily gain — ${measurement(metrics.averageDailyGainKg, (v) => `${number.format(v)} kg/day`)}`,
    `- Feed conversion ratio — ${measurement(metrics.feedConversionRatio, number.format)}`,
    `- Processing yield — ${measurement(metrics.processingYield, percent.format)}`,
    `- Cost per sellable kg — ${cost ? new Intl.NumberFormat(locale, { style: "currency", currency: cost.currency }).format(cost.amountMinorPerKg / 10 ** cost.minorUnitDigits) : "Insufficient records"}`,
    `- Margin — ${margin ? formatMinorUnits(BigInt(margin.amountMinor), margin.currency, margin.minorUnitDigits) : "Insufficient records"}`,
  ].join("\n")
  return {
    content,
    asOf: metrics.asOf,
    reference: result.data.data.reference,
  }
}

export function farmMetricsReply(payload: unknown, batchId: string, locale: string) {
  return verifiedFarmMetrics(payload, batchId, locale)?.content
}

export function parseFarmComparisonRequest(text: string) {
  const match = /^compare (?:farm batches|flocks) #?([1-9]\d*) (?:and|with|vs\.?) #?([1-9]\d*)[.!?]?$/i.exec(text.trim())
  const first = parseAssistantActionId(match?.[1])
  const second = parseAssistantActionId(match?.[2])
  return first && second && first !== second ? [first, second] as const : undefined
}

export async function readAssistantFarmMetrics(
  batchId: string,
  companyId: number,
  locale: string,
  signal?: AbortSignal,
  asOf?: string,
) {
  if (!parseAssistantActionId(batchId)) return undefined
  try {
    const params = new URLSearchParams({ companyId: String(companyId) })
    if (asOf) params.set("asOf", asOf)
    const response = await fetch(`/api/farm-batches/${batchId}?${params}`, {
      cache: "no-store",
      signal,
    })
    const verified = response.ok ? verifiedFarmMetrics(await response.json(), batchId, locale) : undefined
    return asOf && verified?.asOf !== asOf ? undefined : verified
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}
