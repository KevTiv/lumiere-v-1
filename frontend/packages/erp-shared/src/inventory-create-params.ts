/**
 * Maps Inventory module form / prompt payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreateBarcodeNomenclatureParams,
  CreateProductPackagingParams,
  CreateProductSupplierInfoParams,
  CreateProductVariantParams,
  CreateReplenishmentRuleParams,
  CreateStockInventoryLineParams,
  CreateStockInventoryParams,
  CreateUomCategoryParams,
  CreateUomConversionParams,
  CreateUomParams,
} from "@lumiere/stdb/types"

import { optionalBigIntU64, u64IdArrayFromForm } from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"

function field(formData: Record<string, unknown>, camel: string, snake: string): unknown {
  return formData[camel] ?? formData[snake]
}

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bool(v: unknown, fallback = false): boolean {
  if (v === "" || v == null) return fallback
  return Boolean(v)
}

export function toCreateStockInventoryParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateStockInventoryParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null
  const cid = optionalBigIntU64(field(formData, "companyId", "company_id")) ?? companyId
  return {
    companyId: cid,
    name,
    locationIds: u64IdArrayFromForm(field(formData, "locationIds", "location_ids")),
    productIds: u64IdArrayFromForm(field(formData, "productIds", "product_ids")),
    lotIds: u64IdArrayFromForm(field(formData, "lotIds", "lot_ids")),
    ownerIds: u64IdArrayFromForm(field(formData, "ownerIds", "owner_ids")),
    packageIds: u64IdArrayFromForm(field(formData, "packageIds", "package_ids")),
    state: String(field(formData, "state", "state") ?? "draft"),
    accountingDate: (() => {
      const raw = field(formData, "accountingDate", "accounting_date")
      if (raw == null || raw === "") return undefined
      const d = new Date(String(raw))
      return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
    })(),
    categoryId: optionalBigIntU64(field(formData, "categoryId", "category_id")),
    countedMode: String(field(formData, "countedMode", "counted_mode") ?? "all"),
    doneMoveIds: u64IdArrayFromForm(field(formData, "doneMoveIds", "done_move_ids")),
    moveIds: u64IdArrayFromForm(field(formData, "moveIds", "move_ids")),
    adjustmentCount: Math.trunc(num(field(formData, "adjustmentCount", "adjustment_count"), 0)),
    hasAccountMoves: bool(field(formData, "hasAccountMoves", "has_account_moves")),
    exhausted: bool(field(formData, "exhausted", "exhausted")),
    prefilledCount: Math.trunc(num(field(formData, "prefilledCount", "prefilled_count"), 0)),
    started: bool(field(formData, "started", "started")),
    isEditable: field(formData, "isEditable", "is_editable") !== false,
    isStockCheck: field(formData, "isStockCheck", "is_stock_check") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateStockInventoryLineParams(
  formData: Record<string, unknown>,
): CreateStockInventoryLineParams | null {
  const productId = requiredBigIntU64(field(formData, "productId", "product_id"))
  const productUomId = requiredBigIntU64(field(formData, "productUomId", "product_uom_id"))
  const locationId = requiredBigIntU64(field(formData, "locationId", "location_id"))
  if (productId === null || productUomId === null || locationId === null) return null
  return {
    productId,
    productVariantId: optionalBigIntU64(field(formData, "productVariantId", "product_variant_id")),
    productUomId,
    locationId,
    locationName: optionalTrimmedString(field(formData, "locationName", "location_name")),
    prodLotId: optionalBigIntU64(field(formData, "prodLotId", "prod_lot_id")),
    packageId: optionalBigIntU64(field(formData, "packageId", "package_id")),
    partnerId: optionalBigIntU64(field(formData, "partnerId", "partner_id")),
    theoreticalQty: num(field(formData, "theoreticalQty", "theoretical_qty"), 0),
    productQty: num(field(formData, "productQty", "product_qty"), 0),
    inventoryLocationId: optionalBigIntU64(field(formData, "inventoryLocationId", "inventory_location_id")),
    inventoryProductId: optionalBigIntU64(field(formData, "inventoryProductId", "inventory_product_id")),
    inventoryProdLotId: optionalBigIntU64(field(formData, "inventoryProdLotId", "inventory_prod_lot_id")),
    inventoryPackageId: optionalBigIntU64(field(formData, "inventoryPackageId", "inventory_package_id")),
    inventoryPartnerId: optionalBigIntU64(field(formData, "inventoryPartnerId", "inventory_partner_id")),
    packageLevelId: optionalBigIntU64(field(formData, "packageLevelId", "package_level_id")),
    packageLevelIdVisible: bool(field(formData, "packageLevelIdVisible", "package_level_id_visible")),
    state: String(field(formData, "state", "state") ?? "draft"),
    productTracking: String(field(formData, "productTracking", "product_tracking") ?? "none"),
    productBarcode: optionalTrimmedString(field(formData, "productBarcode", "product_barcode")),
    productType: String(field(formData, "productType", "product_type") ?? "product"),
    isEditable: field(formData, "isEditable", "is_editable") !== false,
    outdated: bool(field(formData, "outdated", "outdated")),
    inventoryLocationIdName: optionalTrimmedString(
      field(formData, "inventoryLocationIdName", "inventory_location_id_name"),
    ),
    inventoryProductIdName: optionalTrimmedString(
      field(formData, "inventoryProductIdName", "inventory_product_id_name"),
    ),
    theoreticalQtyText: optionalTrimmedString(field(formData, "theoreticalQtyText", "theoretical_qty_text")),
    productUomCategoryId: optionalBigIntU64(field(formData, "productUomCategoryId", "product_uom_category_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateUomCategoryParams(
  formData: Record<string, unknown>,
): CreateUomCategoryParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null
  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    sequence: Math.max(0, Math.trunc(num(field(formData, "sequence", "sequence"), 10))),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateUomParams(formData: Record<string, unknown>): CreateUomParams | null {
  const categoryId = requiredBigIntU64(field(formData, "categoryId", "category_id"))
  const name = String(field(formData, "name", "name") ?? "").trim()
  const symbol = String(field(formData, "symbol", "symbol") ?? "").trim()
  if (categoryId === null || !name || !symbol) return null
  return {
    categoryId,
    name,
    symbol,
    factor: num(field(formData, "factor", "factor"), 1),
    rounding: num(field(formData, "rounding", "rounding"), 0.01),
    timesBigger: num(field(formData, "timesBigger", "times_bigger"), 1),
    isReferenceUnit: bool(field(formData, "isReferenceUnit", "is_reference_unit")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateUomConversionParams(
  formData: Record<string, unknown>,
): CreateUomConversionParams | null {
  const fromUomId = requiredBigIntU64(field(formData, "fromUomId", "from_uom_id"))
  const toUomId = requiredBigIntU64(field(formData, "toUomId", "to_uom_id"))
  if (fromUomId === null || toUomId === null) return null
  return {
    fromUomId,
    toUomId,
    factor: num(field(formData, "factor", "factor"), 1),
    productId: optionalBigIntU64(field(formData, "productId", "product_id")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProductVariantParams(
  formData: Record<string, unknown>,
): CreateProductVariantParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null
  return {
    name,
    attributeValueIds: u64IdArrayFromForm(field(formData, "attributeValueIds", "attribute_value_ids")),
    standardPrice: num(field(formData, "standardPrice", "standard_price"), 0),
    lstPrice: num(field(formData, "lstPrice", "lst_price"), num(field(formData, "standardPrice", "standard_price"), 0)),
    defaultCode: optionalTrimmedString(field(formData, "defaultCode", "default_code")),
    barcode: optionalTrimmedString(field(formData, "barcode", "barcode")),
  }
}

export function toCreateProductSupplierInfoParams(
  formData: Record<string, unknown>,
  defaults?: { partnerId?: number; productTmplId?: number },
): CreateProductSupplierInfoParams | null {
  const partnerId = requiredBigIntU64(field(formData, "partnerId", "partner_id") ?? defaults?.partnerId)
  const currencyId = requiredBigIntU64(field(formData, "currencyId", "currency_id"))
  if (partnerId === null || currencyId === null) return null
  const tmplRaw = field(formData, "productTmplId", "product_tmpl_id") ?? defaults?.productTmplId
  return {
    partnerId,
    productTmplId: optionalBigIntU64(tmplRaw),
    productId: optionalBigIntU64(field(formData, "productId", "product_id")),
    minQty: num(field(formData, "minQty", "min_qty"), 0),
    price: num(field(formData, "price", "price"), 0),
    currencyId,
    delay: Math.trunc(num(field(formData, "delay", "delay"), 0)),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 10)),
    productName: optionalTrimmedString(field(formData, "productName", "product_name")),
    productCode: optionalTrimmedString(field(formData, "productCode", "product_code")),
    dateStart: undefined,
    dateEnd: undefined,
  }
}

export function toCreateProductPackagingParams(
  formData: Record<string, unknown>,
): CreateProductPackagingParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  const uomId = requiredBigIntU64(field(formData, "uomId", "uom_id"))
  if (!name || uomId === null) return null
  return {
    name,
    qty: num(field(formData, "qty", "qty"), 1),
    uomId,
    barcode: optionalTrimmedString(field(formData, "barcode", "barcode")),
    length: num(field(formData, "length", "length"), 0),
    width: num(field(formData, "width", "width"), 0),
    height: num(field(formData, "height", "height"), 0),
    weight: num(field(formData, "weight", "weight"), 0),
    maxWeight: num(field(formData, "maxWeight", "max_weight"), 0),
  }
}

export function toCreateBarcodeNomenclatureParams(
  formData: Record<string, unknown>,
): CreateBarcodeNomenclatureParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null
  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    isDefault: bool(field(formData, "isDefault", "is_default")),
    upcEanConv: String(field(formData, "upcEanConv", "upc_ean_conv") ?? "none"),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateReplenishmentRuleParams(
  formData: Record<string, unknown>,
): CreateReplenishmentRuleParams | null {
  const productId = requiredBigIntU64(field(formData, "productId", "product_id"))
  const locationId = requiredBigIntU64(field(formData, "locationId", "location_id"))
  const uomId = requiredBigIntU64(field(formData, "uomId", "uom_id"))
  if (productId === null || locationId === null || uomId === null) return null
  return {
    productId,
    locationId,
    warehouseId: optionalBigIntU64(field(formData, "warehouseId", "warehouse_id")),
    uomId,
    productMinQty: num(field(formData, "productMinQty", "product_min_qty") ?? field(formData, "minQty", "min_qty"), 0),
    productMaxQty: num(field(formData, "productMaxQty", "product_max_qty") ?? field(formData, "maxQty", "max_qty"), 0),
    qtyMultiple: num(field(formData, "qtyMultiple", "qty_multiple"), 1),
    leadDays: Math.trunc(num(field(formData, "leadDays", "lead_days"), 0)),
    routeId: optionalBigIntU64(field(formData, "routeId", "route_id")),
    trigger: String(field(formData, "trigger", "trigger") ?? "auto"),
    groupId: optionalBigIntU64(field(formData, "groupId", "group_id")),
    active: field(formData, "active", "active") !== false,
    lastRun: undefined,
    nextRun: undefined,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
