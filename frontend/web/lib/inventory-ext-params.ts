/**
 * Form → SpacetimeDB params for inventory traceability & adjustment reasons.
 */

import type {
  CreateAdjustmentReasonParams,
  CreateStockTraceabilityReportParams,
  CreateTraceabilityRecordParams,
} from '@lumiere/stdb/generated/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  if (v == null || v === '') return null
  try {
    return BigInt(String(v).trim())
  } catch {
    return null
  }
}

function optionalBigIntU64(v: unknown): bigint | undefined {
  const b = requiredBigIntU64(v)
  return b === null ? undefined : b
}

function timestampFromFormDate(v: unknown, fallback = new Date()): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  return stbTimestampFromDate(fallback)
}

/** Comma / whitespace separated unsigned integers → bigint array (invalid tokens skipped). */
export function parseBigIntIdList(raw: unknown): bigint[] {
  const s = String(raw ?? '').trim()
  if (!s) return []
  const out: bigint[] = []
  for (const p of s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    try {
      out.push(BigInt(p))
    } catch {
      /* skip */
    }
  }
  return out
}

export function toCreateAdjustmentReasonParamsFromForm(
  formData: Record<string, unknown>,
): CreateAdjustmentReasonParams | null {
  const code = optionalTrimmedString(formData.code)
  if (!code) return null
  return {
    code,
    description: optionalTrimmedString(formData.description),
    isActive: formData.isActive == null ? true : Boolean(formData.isActive),
    isSystem: Boolean(formData.isSystem),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateTraceabilityRecordParamsFromForm(
  formData: Record<string, unknown>,
): CreateTraceabilityRecordParams | null {
  const productId = requiredBigIntU64(formData.productId)
  const documentId = requiredBigIntU64(formData.documentId)
  const uomId = requiredBigIntU64(formData.uomId)
  const documentType = optionalTrimmedString(formData.documentType)
  const qty = Number(formData.quantity)
  if (!productId || !documentId || !uomId || !documentType || !Number.isFinite(qty)) return null
  return {
    productId,
    documentType,
    documentId,
    quantity: qty,
    uomId,
    date: timestampFromFormDate(formData.date),
    serialId: optionalBigIntU64(formData.serialId),
    lotId: optionalBigIntU64(formData.lotId),
    documentLineId: optionalBigIntU64(formData.documentLineId),
    moveId: optionalBigIntU64(formData.moveId),
    partnerId: optionalBigIntU64(formData.partnerId),
    origin: optionalTrimmedString(formData.origin),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateStockTraceabilityReportParamsFromForm(
  formData: Record<string, unknown>,
): CreateStockTraceabilityReportParams | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null
  const dateFrom = timestampFromFormDate(formData.dateFrom)
  const dateTo = timestampFromFormDate(formData.dateTo)
  if (dateTo.microsSinceUnixEpoch <= dateFrom.microsSinceUnixEpoch) return null
  return {
    name,
    dateFrom,
    dateTo,
    productIds: parseBigIntIdList(formData.productIds),
    lotIds: parseBigIntIdList(formData.lotIds),
    serialIds: parseBigIntIdList(formData.serialIds),
    locationIds: parseBigIntIdList(formData.locationIds),
    warehouseIds: parseBigIntIdList(formData.warehouseIds),
    partnerIds: parseBigIntIdList(formData.partnerIds),
    pickingTypeIds: parseBigIntIdList(formData.pickingTypeIds),
    state: 'draft',
    metadata: optionalTrimmedString(formData.metadata),
  }
}
