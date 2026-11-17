import { isHistoryDate } from "@lumiere/erp-shared/history-period"
import type { ChatMessageSourceRef } from "@lumiere/ui"
import { z } from "zod"

import { apiFetch } from "./api-fetch"
import { readAssistantFarmMetrics } from "./assistant-farm-metrics"
import { isModuleBackfillRecordId, moduleBackfillRecordHref } from "./module-backfill-navigation"

type SalesModule = "sales" | "shop_sales"
type DateRange = { from: string; through: string }
type FarmSelector = { id: string } | { reference: string }

export type AssistantDomainRead =
  | ({ kind: "sales"; module: SalesModule; label?: string } & DateRange)
  | { kind: "farm"; selectors: FarmSelector[]; asOf?: string }
  | { kind: "farm_portfolio"; asOf?: string }
  | { kind: "clarify"; message: string }

type Answer = { content: string; sources: ChatMessageSourceRef[] }
type ReadOptions = { companyId: number; locale: string; signal?: AbortSignal }

const months = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]
const monthName = months.join("|")
const recordId = z.string().refine(isModuleBackfillRecordId)
const maxFarmBatches = 20

function empty(content: string): Answer {
  return { content, sources: [] }
}

function monthRange(year: string, month: string): DateRange | undefined {
  const from = `${year}-${month}-01`
  if (!isHistoryDate(from)) return undefined
  const end = new Date(0)
  end.setUTCFullYear(Number(year), Number(month), 0)
  return { from, through: end.toISOString().slice(0, 10) }
}

function salesPeriod(query: string): DateRange | undefined {
  const dates = [...query.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(([date]) => date)
  if (dates.length) {
    if (dates.length > 2 || !dates.every(isHistoryDate)) return undefined
    const [from, through = from] = dates
    if (dates.length === 2 &&
      !/\b\d{4}-\d{2}-\d{2}\s+(?:through|to|and)\s+\d{4}-\d{2}-\d{2}\b/i.test(query)) return undefined
    if (dates.length === 1 && /\b(?:from|between|since|until|through|before|after)\b/i.test(query)) return undefined
    return from && through && from <= through ? { from, through } : undefined
  }
  if (/\b(?:from|between|since|until|through|before|after)\b/i.test(query)) return undefined
  const isoMonths = [...query.matchAll(/\b(\d{4})-(\d{2})\b/g)]
  const namedMonths = [...query.matchAll(new RegExp(`\\b(${monthName})\\s+(\\d{4})\\b`, "gi"))]
  const years = [...query.matchAll(/\b(?:in|during|for)\s+(\d{4})\b(?!-)/gi)]
  if (isoMonths.length + namedMonths.length + years.length !== 1) return undefined
  const [isoMonth] = isoMonths
  if (isoMonth) return monthRange(isoMonth[1]!, isoMonth[2]!)
  const [namedMonth] = namedMonths
  if (namedMonth) {
    const month = 1 + months.indexOf(namedMonth[1]!.toLowerCase())
    return monthRange(namedMonth[2]!, String(month).padStart(2, "0"))
  }
  const year = years[0]?.[1]
  const from = year && `${year}-01-01`
  return isHistoryDate(from) ? { from, through: `${year}-12-31` } : undefined
}

function parseSalesRead(query: string): AssistantDomainRead | undefined {
  const syntax = query.replace(/"[^"\r\n]*"/g, "")
  const shop = /\bshop[ -]sales\b/i.test(syntax)
  const customer = /\bcustomer[ -]sales\b/i.test(syntax)
  const historical = /\bhistorical sales\b/i.test(syntax)
  const totals = /\b(?:how much|totals?|sum|reported amount|sales amount)\b/i.test(syntax)
  const period = salesPeriod(syntax)
  if (
    !(shop || customer || historical) ||
    !(totals || (period && /^(?:show|give|what|report)\b/i.test(query))) ||
    /^(?:import|upload|save|record|post|reconcile|correct|delete|update|edit)\b/i.test(query) ||
    /\b(?:average|per day|by (?:shop|customer|product)|compare|versus|excluding)\b/i.test(query)
  ) return undefined
  if (shop === customer) {
    return { kind: "clarify", message: "Choose Shop Sales or Customer Sales. Their source observations may overlap." }
  }
  if (!period) {
    return { kind: "clarify", message: "Give an exact date or date range, for example April 2024 or 2024-04-01 through 2024-04-30." }
  }
  const quoted = /(?:\bfor|\bat)\s+"([^"\r\n]+)"/i.exec(query)?.[1]?.trim()
  const target = /\b(?:for|at)\s+(.+?)(?=\s+(?:from|through|between|during|in|on)\b|[?.!]*$)/i.exec(query)?.[1]?.trim()
  const periodTarget = target && new RegExp(`^(?:\\d{4}\\b|${monthName}\\b|all(?: (?:shops|customers|saved sales))?$)`, "i").test(target)
  if ((!quoted && target && !periodTarget) || (quoted && (/[\p{Cc}]/u.test(quoted) || new TextEncoder().encode(quoted).length > 256)) ||
    (query.match(/"/g)?.length ?? 0) !== (quoted ? 2 : 0)) {
    return { kind: "clarify", message: "Put the exact shop or customer name in quotation marks, or ask for all saved sales in the period." }
  }
  return { kind: "sales", module: shop ? "shop_sales" : "sales", ...period, ...(quoted && { label: quoted }) }
}

function farmSelector(text: string): FarmSelector | undefined {
  const named = /^"([^"]+)"$/.exec(text.trim())
  const target = (named?.[1] ?? text).trim()
  const id = target.replace(/^#\s*/, "")
  if (!named && isModuleBackfillRecordId(id)) return { id }
  if (!target || (!named && /^(?:#|\d+$|(?:this|selected|current|all)\b)/i.test(target)) || /[\p{Cc}"]/u.test(target) ||
    new TextEncoder().encode(target).length > 128) return undefined
  return { reference: target }
}

function parseFarmRead(query: string): AssistantDomainRead | undefined {
  const cutoff = /\s+as of\s+(\S+)$/i.exec(query)
  const asOf = cutoff?.[1]
  const prompt = cutoff ? query.slice(0, cutoff.index) : query
  const portfolio = /^(?:show (?:me )?)?(?:(?:farm )?metrics|headcount|(?:recorded )?deaths)\s+for\s+all\s+(?:flocks|farm batches)$/i.test(prompt)
  const single = /^(?:show (?:me )?)?(?:farm )?metrics\s+for\s+(?:the )?(?:farm batch|flock)\s+(.+)$/i.exec(prompt)
  const comparison = /^compare\s+(?:farm batches|flocks)\s+(.+)$/i.exec(prompt)
  if (!portfolio && !single && !comparison) return undefined
  if (asOf && !isHistoryDate(asOf)) {
    return { kind: "clarify", message: "Use a valid farm reporting date in YYYY-MM-DD format." }
  }
  if (portfolio) return { kind: "farm_portfolio", asOf }
  if (single) {
    const selector = farmSelector(single[1]!)
    return selector ? { kind: "farm", selectors: [selector], asOf } : undefined
  }
  const target = comparison![1]!
  const item = '(?:#[1-9]\\d*|[1-9]\\d*|"[^"\\r\\n]+")'
  const validList = new RegExp(`^${item}(?:(?:\\s*(?:,|,\\s*and)\\s*|\\s+(?:and|with|vs\\.?)\\s+)${item}){1,4}$`, "i")
  if (!validList.test(target)) {
    return { kind: "clarify", message: "Compare two to five flock IDs or exact references in quotation marks." }
  }
  const tokens = target.match(new RegExp(item, "g")) ?? []
  const selectors = tokens.flatMap((part) => farmSelector(part) ?? [])
  return tokens.length >= 2 && selectors.length === tokens.length
    ? { kind: "farm", selectors, asOf }
    : { kind: "clarify", message: "Choose valid flock IDs or exact references in quotation marks." }
}

export function parseAssistantDomainRead(query: string, options: { farmEnabled: boolean }): AssistantDomainRead | undefined {
  const prompt = query.trim().replace(/[.?!]+$/, "").trim()
  if (!prompt || prompt.length > 512) return undefined
  return parseSalesRead(prompt) ?? (options.farmEnabled ? parseFarmRead(prompt) : undefined)
}

const salesResponse = z.object({
  data: z.object({
    companyId: z.string(),
    module: z.enum(["sales", "shop_sales"]),
    from: z.string(),
    through: z.string(),
    label: z.string().nullable(),
    included: z.number().int().min(0).max(5_000),
    crossingBoundary: z.number().int().min(0).max(5_000),
    totals: z.array(z.object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      reportedAmount: z.string().regex(/^\d{1,16}(?:\.\d{1,6})?$/),
    })),
    sourceRecordIds: z.array(recordId).max(5),
  }),
})

async function readSales(request: Extract<AssistantDomainRead, { kind: "sales" }>, options: ReadOptions): Promise<Answer> {
  const { companyId, signal } = options
  const { module, from, through, label } = request
  const params = new URLSearchParams({ companyId: String(companyId), from, through })
  if (label) params.set("label", label)
  const response = await apiFetch(`/api/module-backfill/${module}/sales-summary?${params}`, { signal, cache: "no-store" })
  if (response.status === 422) return empty("Too many saved sales records match this period. Choose a shorter period.")
  if (!response.ok) return empty("The saved sales records could not be read in this company.")
  return assistantSalesSummary(await response.json(), request, companyId)
}

export function assistantSalesSummary(payload: unknown, request: Extract<AssistantDomainRead, { kind: "sales" }>, companyId: number): Answer {
  const result = salesResponse.safeParse(payload)
  const data = result.success ? result.data.data : undefined
  if (!data || data.companyId !== String(companyId) || data.module !== request.module ||
    data.from !== request.from || data.through !== request.through || data.label !== (request.label ?? null) ||
    data.included + data.crossingBoundary > 5_000 ||
    data.sourceRecordIds.length !== Math.min(5, data.included) ||
    new Set(data.sourceRecordIds).size !== data.sourceRecordIds.length ||
    new Set(data.totals.map(({ currency }) => currency)).size !== data.totals.length ||
    data.totals.length > data.included ||
    (data.included > 0 && data.totals.length === 0)) {
    return empty("The saved sales totals could not be verified.")
  }
  const title = data.module === "shop_sales" ? "Shop Sales" : "Customer Sales"
  const basis = data.label ? " for the matching name" : ""
  const content = data.included
    ? [
        `**Saved ${title} · ${data.from} through ${data.through}**`,
        `Sum of ${data.included} saved sales observation${data.included === 1 ? "" : "s"}${basis}.`,
        ...data.totals.map(({ currency, reportedAmount }) => `- ${currency} ${reportedAmount}`),
        "These are reported amounts from imported sources. They may overlap with other source reports.",
      ]
    : [`No saved ${title} observations${basis} fall wholly inside ${data.from} through ${data.through}.`]
  if (data.crossingBoundary) {
    content.push(data.crossingBoundary === 1
      ? "One observation spans a reporting boundary and was excluded."
      : `${data.crossingBoundary} observations span a reporting boundary and were excluded.`)
  }
  if (data.included > data.sourceRecordIds.length) content.push("Sources show a sample of the included records.")
  return {
    content: content.join("\n"),
    sources: data.sourceRecordIds.map(id => ({
      kind: "activity",
      trust: "persisted",
      entity_type: data.module === "shop_sales" ? "shop_sale" : "customer_sales_observation",
      entity_id: id,
      label: `Saved ${title} #${id}`,
      href: moduleBackfillRecordHref(data.module, { companyId, recordId: id }),
    })),
  }
}

const farmReference = z.object({ data: z.object({ id: recordId }) })
const count = z.string().regex(/^(?:0|[1-9]\d{0,38})$/)
const farmPortfolio = z.object({
  data: z.object({
    companyId: z.string(),
    asOf: z.string().refine(isHistoryDate),
    batches: z.number().int().min(0).max(maxFarmBatches),
    recordedDeaths: count,
    liveHeadcount: count.nullable(),
    sources: z.array(z.object({ id: recordId, reference: z.string() })).max(5),
  }),
})

async function resolveFarm(selector: FarmSelector, options: ReadOptions): Promise<string | undefined> {
  if ("id" in selector) return selector.id
  const params = new URLSearchParams({ companyId: String(options.companyId), reference: selector.reference })
  const response = await apiFetch(`/api/farm-batches/resolve?${params}`, { signal: options.signal, cache: "no-store" })
  if (!response.ok) return undefined
  const result = farmReference.safeParse(await response.json())
  return result.success ? result.data.data.id : undefined
}

function farmSource(id: string, asOf: string, reference?: string): ChatMessageSourceRef {
  return {
    kind: "live",
    trust: "authoritative",
    entity_type: "farm_batch",
    entity_id: id,
    label: reference ? `Farm batch ${reference}` : `Farm batch #${id}`,
    href: `/farm-batches/${id}?${new URLSearchParams({ view: "metrics", asOf })}`,
  }
}

async function readFarms(request: Extract<AssistantDomainRead, { kind: "farm" }>, options: ReadOptions): Promise<Answer> {
  const ids = await Promise.all(request.selectors.map(selector => resolveFarm(selector, options)))
  const [firstId, ...rest] = ids
  if (!firstId || rest.some(id => !id)) return empty("One or more farm batches are unavailable in this company. Check their exact references or IDs.")
  const distinct = [...new Set(rest.filter((id): id is string => Boolean(id && id !== firstId)))]
  if (distinct.length + 1 !== ids.length) return empty("Choose distinct farm batches to compare.")
  const { companyId, locale, signal } = options
  const first = await readAssistantFarmMetrics(firstId, companyId, locale, signal, request.asOf)
  if (!first) return empty("Farm metrics could not be read for the requested batch and date.")
  const other = await Promise.all(distinct.map(id => readAssistantFarmMetrics(id, companyId, locale, signal, first.asOf)))
  if (other.some(metric => !metric)) return empty("Each batch must be available at the same cutoff to compare its metrics.")
  return {
    content: [first.content, ...other.flatMap(metric => metric?.content ?? [])].join("\n\n"),
    sources: [
      farmSource(firstId, first.asOf, first.reference),
      ...distinct.map((id, index) => farmSource(id, first.asOf, other[index]?.reference)),
    ],
  }
}

async function readFarmPortfolio(request: Extract<AssistantDomainRead, { kind: "farm_portfolio" }>, options: ReadOptions): Promise<Answer> {
  const { companyId, locale, signal } = options
  const params = new URLSearchParams({ companyId: String(companyId) })
  if (request.asOf) params.set("asOf", request.asOf)
  const response = await apiFetch(`/api/farm-batches/portfolio?${params}`, { signal, cache: "no-store" })
  if (response.status === 422) return empty(`The farm portfolio exceeds one read. Compare specific flock IDs or references. The company total supports up to ${maxFarmBatches} batches.`)
  if (!response.ok) return empty("Farm batches could not be read in this company.")
  return assistantFarmPortfolio(await response.json(), companyId, locale, request.asOf)
}

export function assistantFarmPortfolio(payload: unknown, companyId: number, locale: string, requestedCutoff?: string): Answer {
  const result = farmPortfolio.safeParse(payload)
  const data = result.success ? result.data.data : undefined
  if (!data || data.companyId !== String(companyId) || (requestedCutoff && data.asOf !== requestedCutoff) ||
    data.sources.length !== Math.min(5, data.batches) ||
    new Set(data.sources.map(({ id }) => id)).size !== data.sources.length) {
    return empty("The farm company and reporting date could not be verified.")
  }
  const { asOf, batches, liveHeadcount, recordedDeaths } = data
  if (!batches) return empty(`No farm batches had started in this company by ${asOf}.`)
  const sources = data.sources.map(({ id, reference }) => farmSource(id, asOf, reference))
  const number = new Intl.NumberFormat(locale)
  return {
    content: [
      `**Company farm totals · ${asOf}**`,
      `- Farm batches — ${batches}`,
      `- Recorded deaths — ${number.format(BigInt(recordedDeaths))}`,
      `- Live headcount — ${liveHeadcount == null ? "Insufficient records for a company total" : number.format(BigInt(liveHeadcount))}`,
      ...(batches > sources.length ? ["Sources show a sample of the included batches."] : []),
    ].join("\n"),
    sources,
  }
}

/** Read signed-in ERP data and format the result without asking a model to calculate the totals. */
export async function readAssistantDomainRead(request: AssistantDomainRead, options: ReadOptions): Promise<Answer> {
  try {
    switch (request.kind) {
      case "sales": return await readSales(request, options)
      case "farm": return await readFarms(request, options)
      case "farm_portfolio": return await readFarmPortfolio(request, options)
      case "clarify": return empty(request.message)
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    return empty("The requested records could not be read. Please retry.")
  }
}
