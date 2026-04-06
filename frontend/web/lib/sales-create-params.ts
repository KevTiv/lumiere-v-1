/**
 * Maps Sales module form payloads to SpacetimeDB reducer param types.
 */

import type { CreatePricelistParams, CreateSaleOrderParams } from '@lumiere/stdb/generated/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function optionalBigIntU64(v: unknown): bigint | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'bigint') return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  try {
    return BigInt(String(v).trim())
  } catch {
    return undefined
  }
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function optionalTimestampFromFormDate(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

function discountPolicyFromForm(raw: unknown): CreatePricelistParams['discountPolicy'] {
  const s = String(raw ?? 'WithoutDiscount')
  if (s === 'WithDiscount') return { tag: 'WithDiscount' }
  return { tag: 'WithoutDiscount' }
}

export function toCreateSaleOrderParams(
  formData: Record<string, unknown>,
  pricelists: ReadonlyArray<Record<string, unknown>>,
  companyId: bigint,
): CreateSaleOrderParams | null {
  const partnerRaw = formData.partnerId
  const pricelistRaw = formData.pricelistId
  const warehouseRaw = formData.warehouseId
  if (partnerRaw === '' || partnerRaw == null) return null
  if (pricelistRaw === '' || pricelistRaw == null) return null
  if (warehouseRaw === '' || warehouseRaw == null) return null

  const partnerId = requiredBigIntU64(partnerRaw)
  const pricelistId = requiredBigIntU64(pricelistRaw)
  const warehouseId = requiredBigIntU64(warehouseRaw)
  if (partnerId == null || pricelistId == null || warehouseId == null) return null

  const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw))
  const currencyRaw = pl?.currencyId
  if (currencyRaw === undefined || currencyRaw === null) return null
  const currencyId = requiredBigIntU64(currencyRaw)
  if (currencyId == null) return null

  const paymentTermId =
    formData.paymentTermId != null && formData.paymentTermId !== ''
      ? optionalBigIntU64(formData.paymentTermId)
      : undefined

  const commitmentDate = optionalTimestampFromFormDate(formData.commitmentDate)

  return {
    companyId,
    partnerId,
    partnerInvoiceId: partnerId,
    partnerShippingId: partnerId,
    pricelistId,
    currencyId,
    warehouseId,
    orderLines: [],
    origin: undefined,
    clientOrderRef: optionalTrimmedString(formData.clientOrderRef),
    paymentTermId,
    fiscalPositionId: undefined,
    teamId: undefined,
    opportunityId: undefined,
    note: optionalTrimmedString(formData.note),
    termsAndConditions: undefined,
    validityDays: undefined,
    shippingPolicy: undefined,
    pickingPolicy: undefined,
    campaignId: undefined,
    mediumId: undefined,
    sourceId: undefined,
    commitmentDate,
    expectedDate: undefined,
    incoterm: undefined,
    incotermLocation: undefined,
    carrierId: undefined,
    customerLead: undefined,
    analyticAccountId: undefined,
    userId: undefined,
    isPrinted: undefined,
    isLocked: undefined,
    isDropship: undefined,
    messageFollowerIds: undefined,
    messagePartnerIds: undefined,
    messageChannelIds: undefined,
    activityIds: undefined,
    metadata: formData.validityDate
      ? JSON.stringify({ validityDate: formData.validityDate })
      : undefined,
  }
}

export function toCreatePricelistParams(
  formData: Record<string, unknown>,
): CreatePricelistParams | null {
  const cid = formData.currencyId
  if (cid === '' || cid == null) return null
  const currencyId = requiredBigIntU64(cid)
  if (currencyId == null) return null

  return {
    name: String(formData.name ?? ''),
    currencyId,
    discountPolicy: discountPolicyFromForm(formData.discountPolicy),
  }
}

export function salesParamsToJson(
  params: CreateSaleOrderParams | CreatePricelistParams,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

/** Comma- or whitespace-separated stock picking IDs → create_picking_batch params JSON. */
export function toCreatePickingBatchParamsJson(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null
  const raw = formData.pickingIds
  const parts =
    raw == null || String(raw).trim() === ''
      ? []
      : String(raw)
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
  const pickingIds = parts.map((p) => BigInt(p))
  return stdbParamsToJson({
    name,
    pickingIds,
    isWave: false,
  })
}
