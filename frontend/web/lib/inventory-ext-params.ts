/**
 * Form → SpacetimeDB params for inventory traceability & adjustment reasons.
 */

import type {
  CreateAdjustmentReasonParams,
  CreateStockTraceabilityReportParams,
  CreateTraceabilityRecordParams,
} from "@lumiere/stdb/generated/types"
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  if (v == null || v === "") return null
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
  if (v != null && String(v).trim() !== "") {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  return stbTimestampFromDate(fallback)
}

/** Comma / whitespace separated unsigned integers → bigint array (invalid tokens skipped). */
export function parseBigIntIdList(raw: unknown): bigint[] {
  const s = String(raw ?? "").trim()
  if (!s) return []
  const out: bigint[] = []
  for (const p of s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
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

/** JSON metadata blob for `create_inventory_adjustment` from module / quick-action forms. */
export function adjustmentCreateMetadataFromForm(formData: Record<string, unknown>): string {
  return JSON.stringify({
    source: "inventory-ui",
    date: formData.date != null ? String(formData.date) : undefined,
    originalForm: formData,
  })
}

/** Metadata JSON for `create_product_category` (removal strategy + costing embedded). */
export function productCategoryCreateMetadataFromForm(
  removalStrategyId: number | undefined,
  formData: Record<string, unknown>,
): string {
  return JSON.stringify({
    removalStrategyId,
    costingMethod: String(formData.costingMethod ?? "standard"),
    propertyValuation: String(formData.propertyValuation ?? "manual_periodic"),
  })
}

/** SpacetimeDB sum-type encoding for `ZoneDisplayType` (warehouse 3D zones). */
export function zoneDisplayTypeForReducer(tag: string): Record<string, unknown> {
  const t = String(tag || "Rack")
  if (t === "Floor") return { Floor: [] }
  if (t === "Bin") return { Bin: [] }
  return { Rack: [] }
}

/** `params` object for `create_warehouse_3d_zone` from quick-action / dashboard form values. */
export function warehouse3dZoneParamsFromForm(formData: Record<string, unknown>): Record<string, unknown> {
  const dt = String(formData.displayType ?? "Rack")
  return {
    displayType: zoneDisplayTypeForReducer(dt),
    color: String(formData.color ?? "#0e7490"),
    width: Number(formData.width ?? 10),
    height: Number(formData.height ?? 3),
    depth: Number(formData.depth ?? 8),
    rows: Math.max(0, Math.floor(Number(formData.rows ?? 4))),
    columns: Math.max(0, Math.floor(Number(formData.columns ?? 8))),
    levels: Math.max(0, Math.floor(Number(formData.levels ?? 3))),
  }
}

/** Payload for `create_picking_wave` aligned with `CreatePickingWaveParams`. */
export function pickingWaveCreateParamsFromForm(
  formData: Record<string, unknown>,
  /** Optional extras (e.g. warehouse / user ids) merged into `metadata` JSON. */
  warehouseUserMeta?: Record<string, unknown>,
): Record<string, unknown> {
  const name = String(formData.name ?? "").trim()
  const scheduledRaw = formData.scheduledDate
  const dateStart: Timestamp =
    scheduledRaw != null && String(scheduledRaw).trim() !== ""
      ? stbTimestampFromDate(new Date(String(scheduledRaw)))
      : stbTimestampFromDate(new Date())

  const out: Record<string, unknown> = {
    name,
    pickingTypeId: Number(formData.pickingTypeId ?? 0),
    state: "draft",
    isWave: true,
    pickingIds: [] as number[],
    moveLineIds: [] as number[],
    dateStart,
  }
  if (warehouseUserMeta && Object.keys(warehouseUserMeta).length > 0) {
    out.metadata = JSON.stringify(warehouseUserMeta)
  }
  return out
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
    state: "draft",
    metadata: optionalTrimmedString(formData.metadata),
  }
}
