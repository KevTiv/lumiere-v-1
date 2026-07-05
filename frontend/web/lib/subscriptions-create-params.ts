/**
 * Maps Subscriptions module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function parseU64FromForm(v: unknown): bigint | null {
  if (v === "" || v == null) return null
  if (typeof v === "bigint") return v >= 0n ? v : null
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) return BigInt(n)
  try {
    const b = BigInt(String(v).trim())
    return b >= 0n ? b : null
  } catch {
    return null
  }
}

function requiredTimestampFromFormDate(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

export function toCreateSubscriptionFromSaleOrderParams(
  formData: Record<string, unknown>,
  saleOrders: ReadonlyArray<Record<string, unknown>>,
  companyId?: bigint,
): CreateSubscriptionFromSaleOrderParams | null {
  const soRaw = formData.saleOrderId
  const planRaw = formData.planId
  if (soRaw === "" || soRaw == null || planRaw === "" || planRaw == null) return null

  const saleOrderId = parseU64FromForm(soRaw)
  const planId = parseU64FromForm(planRaw)
  if (saleOrderId == null || planId == null) return null

  const so = saleOrders.find((s) => String(s.id) === String(soRaw))
  if (!so) return null

  const partnerId = parseU64FromForm(so.partnerId)
  const partnerInvoiceId = parseU64FromForm(so.partnerInvoiceId)
  const partnerShippingId = parseU64FromForm(so.partnerShippingId)
  const currencyId = parseU64FromForm(so.currencyId)
  const pricelistId = parseU64FromForm(so.pricelistId)
  if (
    partnerId == null ||
    partnerInvoiceId == null ||
    partnerShippingId == null ||
    currencyId == null ||
    pricelistId == null
  ) {
    return null
  }

  const dateStart = requiredTimestampFromFormDate(
    formData.dateStart ?? new Date().toISOString(),
  )
  if (dateStart == null) return null

  const recurringDay = Math.min(
    31,
    Math.max(1, Math.floor(Number(formData.recurringInvoiceDay ?? 1))),
  )

  return {
    companyId,
    saleOrderId,
    code: optionalTrimmedString(formData.code),
    planId,
    dateStart,
    recurringInvoiceDay: recurringDay,
    isTrial: formData.isTrial === true,
    description: optionalTrimmedString(formData.description),
    recurringRuleType: String(formData.recurringRuleType ?? "monthly"),
    recurringInterval: Math.max(1, Math.floor(Number(formData.recurringInterval ?? 1))),
    paymentMode: String(formData.paymentMode ?? "manual"),
    partnerId,
    vendorId: undefined,
    partnerInvoiceId,
    partnerShippingId,
    currencyId,
    pricelistId,
    analyticAccountId: undefined,
    teamId: undefined,
    health: String(formData.health ?? "normal"),
    stageId: undefined,
    state: String(formData.state ?? "draft"),
    isActive: true,
    invoiceCount: 0,
    recurringTotal: 0,
    recurringMonthly: 0,
    recurringMrr: 0,
    recurringMrrLocal: 0,
    percentageMrr: 0,
    kpi1MonthMrr: 0,
    kpi3MonthsMrr: 0,
    kpi12MonthsMrr: 0,
    ratingLastValue: 0,
    invoiceIds: [],
    subscriptionLineIds: [],
    activityIds: [],
    messageFollowerIds: [],
    messageIds: [],
    metadata: undefined,
  }
}

export function toCreateSubscriptionPlanParams(
  formData: Record<string, unknown>,
  pricelists: ReadonlyArray<Record<string, unknown>>,
  companyId?: bigint,
): CreateSubscriptionPlanParams | null {
  const plRaw = formData.pricelistId
  const jRaw = formData.journalId
  const prodRaw = formData.productId
  if (
    plRaw === "" ||
    plRaw == null ||
    jRaw === "" ||
    jRaw == null ||
    prodRaw === "" ||
    prodRaw == null
  ) {
    return null
  }

  const journalId = parseU64FromForm(jRaw)
  const productId = parseU64FromForm(prodRaw)
  if (journalId == null || productId == null) return null

  const pl = pricelists.find((p) => String(p.id) === String(plRaw))
  if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return null

  const currencyId = parseU64FromForm(pl.currencyId)
  if (currencyId == null) return null

  const name = String(formData.name ?? "").trim()
  if (!name) return null

  const billingPeriodUnit = Math.max(1, Math.floor(Number(formData.billingPeriodUnit ?? 1)))
  const billingPeriod = String(formData.billingPeriod ?? "monthly")

  return {
    companyId,
    name,
    code: optionalTrimmedString(formData.code) ?? name,
    description: optionalTrimmedString(formData.description),
    currencyId,
    journalId,
    productId,
    billingPeriod,
    billingPeriodUnit,
    recurringInvoiceDay: 1,
    trialPeriod: Boolean(formData.trialPeriod),
    trialDuration: Number(formData.trialDuration ?? 0),
    trialUnit: "day",
    autoCloseLimit: 0,
    paymentMode: "manual",
    templateId: undefined,
    invoiceMailTemplateId: undefined,
    websiteUrl: undefined,
    isPublished: true,
    isDefault: Boolean(formData.isDefault),
    color: 0,
    image1920Url: undefined,
    active: true,
    recurringRuleCount: billingPeriodUnit,
    recurringRuleMinUnit: billingPeriod,
    recurringRuleMaxUnit: billingPeriod,
    recurringRuleMinCount: billingPeriodUnit,
    recurringRuleMaxCount: billingPeriodUnit,
    metadata: undefined,
  }
}
