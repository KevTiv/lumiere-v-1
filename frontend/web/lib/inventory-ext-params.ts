/**
 * Form → SpacetimeDB params for inventory traceability & adjustment reasons.
 */

import type {
  CreateAdjustmentReasonParams,
  CreateStockMoveParams,
  CreateStockTraceabilityReportParams,
  CreateTraceabilityRecordParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { nullableBigIntU64, optionalBigIntU64, optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

export type InventoryCreateProductPayload = Record<string, unknown> & {
  name: string
  categId: number
  type: string
  uomId: number
  uomPoId: number
  standardPrice: number
  listPrice: number
  currencyId: number
  defaultCode: string | undefined
  saleOk: boolean
  purchaseOk: boolean
  displayName: string | undefined
  pricelistId: number | undefined
  description: string | undefined
}

export type InventoryCreateStockPickingPayload = Record<string, unknown> & {
  name: string
  pickingTypeId: number
  locationId: number
  locationDestId: number
  scheduledDate: Date | undefined
  origin: string | undefined
  note: string | undefined
}

export type InventoryCreateAdjustmentPayload = Record<string, unknown> & {
  name: string
  productId: number
  locationId: number
  quantityBefore: number
  quantityAfter: number
  reasonCode: string
  state: string
  adjustmentType: string
  uomId: number
  unitCost: number
  reasonNotes: string | undefined
  metadata: string
}

export type InventoryCreateStockLocationPayload = Record<string, unknown> & {
  name: string
  usage: string
  locationCategory: string
  parentPath: string
  locationId: number | undefined
  barcode: string | undefined
}

export type InventoryCreateProductCategoryPayload = Record<string, unknown> & {
  name: string
  parentId: number | undefined
  sequence: number
  metadata: string
}

export type InventoryCreateBarcodeRulePayload = Record<string, unknown> & {
  name: string
  pattern: string
  encoding: string
  type: string
  sequence: number
}

export type InventoryCreateStockQuantPayload = Record<string, unknown> & {
  productId: number
  locationId: number
  quantity: number
  reservedQuantity: number
  cost: number
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

export function toCreateProductParamsFromForm(
  formData: Record<string, unknown>,
  currencyId: number,
): InventoryCreateProductPayload | null {
  const categRaw = formData.categId
  const uomRaw = formData.uomId
  if (categRaw === "" || categRaw == null || uomRaw === "" || uomRaw == null) return null
  const categId = Number(categRaw)
  const uomId = Number(uomRaw)
  const uomPoRaw = formData.uomPoId
  const uomPoId =
    uomPoRaw !== "" && uomPoRaw != null && String(uomPoRaw).trim() !== ""
      ? Number(uomPoRaw)
      : uomId
  const standard = Number(formData.standardPrice ?? 0)
  return {
    name: String(formData.name ?? ""),
    categId,
    type: String(formData.type ?? "product"),
    uomId,
    uomPoId,
    standardPrice: standard,
    listPrice: standard,
    currencyId,
    defaultCode: formData.defaultCode ? String(formData.defaultCode) : undefined,
    saleOk: formData.saleOk == null ? true : Boolean(formData.saleOk),
    purchaseOk: formData.purchaseOk == null ? true : Boolean(formData.purchaseOk),
    displayName: formData.name ? String(formData.name) : undefined,
    pricelistId: formData.pricelistId != null ? Number(formData.pricelistId) : undefined,
    description: optionalTrimmedString(formData.description),
  }
}

export function toCreateStockPickingParamsFromForm(
  formData: Record<string, unknown>,
): InventoryCreateStockPickingPayload | null {
  const pickingRaw = formData.pickingTypeId
  const locFrom = formData.locationId
  const locTo = formData.locationDestId
  if (
    pickingRaw === "" ||
    pickingRaw == null ||
    locFrom === "" ||
    locFrom == null ||
    locTo === "" ||
    locTo == null
  ) {
    return null
  }
  const originStr = formData.origin ? String(formData.origin) : ""
  return {
    name: originStr.trim() !== "" ? originStr : "New Transfer",
    pickingTypeId: Number(pickingRaw),
    locationId: Number(locFrom),
    locationDestId: Number(locTo),
    scheduledDate: formData.scheduledDate ? new Date(String(formData.scheduledDate)) : undefined,
    origin: originStr.trim() !== "" ? originStr : undefined,
    note: optionalTrimmedString(formData.note),
  }
}

/** Manual / prompt-driven stock move — full `CreateStockMoveParams` with explicit defaults. */
export function toCreateStockMoveParams(input: {
  companyId?: bigint | number
  name: string
  productId: bigint | number
  productUom: bigint | number
  quantity: number
  locationId: bigint | number
  locationDestId: bigint | number
  dateExpected?: Timestamp
}): CreateStockMoveParams {
  const productId = BigInt(input.productId)
  return {
    companyId: input.companyId != null ? BigInt(input.companyId) : undefined,
    name: input.name,
    productId,
    productTmplId: productId,
    productUom: BigInt(input.productUom),
    productUomQty: input.quantity,
    locationId: BigInt(input.locationId),
    locationDestId: BigInt(input.locationDestId),
    dateExpected: input.dateExpected ?? stbTimestampFromDate(new Date()),
    moveType: "direct",
    priority: "0",
    reference: undefined,
    sequence: 10,
    origin: undefined,
    note: undefined,
    date: undefined,
    dateDeadline: undefined,
    pickingId: undefined,
    pickingTypeId: undefined,
    partnerId: undefined,
    productVariantId: undefined,
    groupId: undefined,
    ruleId: undefined,
    procureMethod: "make_to_stock",
    priceUnit: 0,
    scrapped: false,
    toRefund: false,
    propagateCancel: false,
    delayAlert: false,
    productPackagingId: undefined,
    productPackagingQty: 0,
    warehouseId: undefined,
    productionId: undefined,
    rawMaterialProductionId: undefined,
    unbuildId: undefined,
    consumeUnbuildId: undefined,
    costShare: 0,
    isSubcontract: false,
    purchaseLineId: undefined,
    needRelease: false,
    releaseReady: false,
    propagationCancel: false,
    hasTracking: false,
    inventoryId: undefined,
    saleLineId: undefined,
    lotId: undefined,
    packageId: undefined,
    resultPackageId: undefined,
    ownerId: undefined,
    packageLevelId: undefined,
    productType: undefined,
    metadata: undefined,
  }
}

export function toCreateInventoryAdjustmentParamsFromForm(
  formData: Record<string, unknown>,
  uomId: number,
): InventoryCreateAdjustmentPayload | null {
  const productRaw = formData.productId
  const locRaw = formData.locationId
  if (productRaw === "" || productRaw == null || locRaw === "" || locRaw == null) return null
  const qtyAfter = Number(formData.countQty ?? formData.inventoryQuantity ?? 0)
  const bookRaw = formData.bookQuantity
  const qtyBefore =
    bookRaw !== "" && bookRaw != null && String(bookRaw).trim() !== ""
      ? Number(bookRaw)
      : qtyAfter
  return {
    name: String(formData.name ?? "Inventory Adjustment"),
    productId: Number(productRaw),
    locationId: Number(locRaw),
    quantityBefore: qtyBefore,
    quantityAfter: qtyAfter,
    reasonCode: String(formData.reasonCode ?? "INV_ADJ").trim() || "INV_ADJ",
    state: "draft",
    adjustmentType: "quantity",
    uomId,
    unitCost: Number(formData.standardPrice ?? 0),
    reasonNotes: formData.reasonNotes ? String(formData.reasonNotes) : undefined,
    metadata: adjustmentCreateMetadataFromForm(formData),
  }
}

export function toCreateStockLocationParamsFromForm(
  formData: Record<string, unknown>,
): InventoryCreateStockLocationPayload | null {
  const name = String(formData.name ?? "").trim()
  if (!name) return null
  const usage = String(formData.usage ?? "internal")
  const parentRaw = formData.parentLocationId
  const parentId =
    parentRaw !== "" && parentRaw != null && String(parentRaw).trim() !== ""
      ? Number(parentRaw)
      : undefined
  return {
    name,
    usage,
    locationCategory: usage,
    parentPath: parentId ? "" : "/",
    locationId: parentId,
    barcode: formData.barcode ? String(formData.barcode) : undefined,
  }
}

export function toCreateProductCategoryParamsFromForm(
  formData: Record<string, unknown>,
): InventoryCreateProductCategoryPayload | null {
  const name = String(formData.name ?? "").trim()
  if (!name) return null
  const removalStrategyId = formData.removalStrategyId
    ? Number(formData.removalStrategyId)
    : undefined
  return {
    name,
    parentId: formData.parentId ? Number(formData.parentId) : undefined,
    sequence: Number(formData.sequence ?? 10),
    metadata: productCategoryCreateMetadataFromForm(removalStrategyId, formData),
  }
}

export function toCreateBarcodeRuleParamsFromForm(
  formData: Record<string, unknown>,
): InventoryCreateBarcodeRulePayload | null {
  const name = String(formData.name ?? "").trim()
  const pattern = String(formData.pattern ?? "").trim()
  if (!name || !pattern) return null
  return {
    name,
    pattern,
    encoding: String(formData.encoding ?? "any"),
    type: String(formData.type ?? "product"),
    sequence: Number(formData.sequence ?? 100),
  }
}

export function toCreateStockQuantParamsFromForm(
  formData: Record<string, unknown>,
): InventoryCreateStockQuantPayload | null {
  const p = formData.productId
  const l = formData.locationId
  if (p === "" || p == null || l === "" || l == null) return null
  return {
    productId: Number(p),
    locationId: Number(l),
    quantity: Number(formData.quantity ?? 0),
    reservedQuantity: Number(formData.reservedQuantity ?? 0),
    cost: Number(formData.cost ?? 0),
  }
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
  const productId = nullableBigIntU64(formData.productId)
  const documentId = nullableBigIntU64(formData.documentId)
  const uomId = nullableBigIntU64(formData.uomId)
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
  /** Optional extras merged into `metadata` JSON. */
  warehouseUserMeta?: Record<string, unknown>,
): Record<string, unknown> {
  const name = String(formData.name ?? "").trim()
  const scheduledRaw = formData.scheduledDate
  const userId = formData.userId
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
    userId: userId != null && String(userId).trim() !== "" ? String(userId) : undefined,
    dateStart,
  }
  const metadata = {
    ...(warehouseUserMeta ?? {}),
  }
  if (Object.keys(metadata).length > 0) {
    out.metadata = JSON.stringify(metadata)
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
