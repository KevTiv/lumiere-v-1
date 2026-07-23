/** Auto-generated Create*Params mappers for inventory coverage gap. */

import type {
  CreateInventoryCloseParams,
  CreateInventoryIntegrationIntentParams,
  CreatePackagingMaterialParams,
  CreateStockPackageParams,
  CreateWarehouseSyncIntentParams,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "./create-params-helpers"

export function toCreateInventoryCloseParams(
  formData: Record<string, unknown>,
): CreateInventoryCloseParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    asOf: optionalTimestampFromForm(field(formData, "asOf", "as_of")),
    journalId: optionalBigIntU64(field(formData, "journalId", "journal_id")),
    inventoryAccountId: optionalBigIntU64(field(formData, "inventoryAccountId", "inventory_account_id")),
    valuationAccountId: optionalBigIntU64(field(formData, "valuationAccountId", "valuation_account_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateInventoryIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateInventoryIntegrationIntentParams | null {
  const provider = optionalTrimmedString(field(formData, "provider", "provider"))
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  if (!provider || !intentType || !idempotencyKey) return null

  return {
    provider,
    intentType,
    warehouseId: optionalBigIntU64(field(formData, "warehouseId", "warehouse_id")),
    pickingId: optionalBigIntU64(field(formData, "pickingId", "picking_id")),
    idempotencyKey,
    requestPayload: optionalTrimmedString(field(formData, "requestPayload", "request_payload")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePackagingMaterialParams(
  formData: Record<string, unknown>,
): CreatePackagingMaterialParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const materialType = optionalTrimmedString(field(formData, "materialType", "material_type"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (!name || !materialType || currencyId === undefined) return null

  return {
    name,
    materialType,
    weight: num(field(formData, "weight", "weight"), 0),
    maxWeight: num(field(formData, "maxWeight", "max_weight"), 0),
    length: num(field(formData, "length", "length"), 0),
    width: num(field(formData, "width", "width"), 0),
    height: num(field(formData, "height", "height"), 0),
    volume: num(field(formData, "volume", "volume"), 0),
    cost: num(field(formData, "cost", "cost"), 0),
    currencyId,
    barcode: optionalTrimmedString(field(formData, "barcode", "barcode")),
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateStockPackageParams(
  formData: Record<string, unknown>,
): CreateStockPackageParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    packagingMaterialId: optionalBigIntU64(field(formData, "packagingMaterialId", "packaging_material_id")),
    pickingId: optionalBigIntU64(field(formData, "pickingId", "picking_id")),
    locationId: optionalBigIntU64(field(formData, "locationId", "location_id")),
    locationDestId: optionalBigIntU64(field(formData, "locationDestId", "location_dest_id")),
    weight: num(field(formData, "weight", "weight"), 0),
    volume: num(field(formData, "volume", "volume"), 0),
    shippingWeight: num(field(formData, "shippingWeight", "shipping_weight"), 0),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWarehouseSyncIntentParams(
  formData: Record<string, unknown>,
): CreateWarehouseSyncIntentParams | null {
  const warehouseId = optionalBigIntU64(field(formData, "warehouseId", "warehouse_id"))
  const opType = optionalTrimmedString(field(formData, "opType", "op_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  if (warehouseId === undefined || !opType || !idempotencyKey) return null

  return {
    warehouseId,
    opType,
    idempotencyKey,
    deviceId: optionalTrimmedString(field(formData, "deviceId", "device_id")),
    payload: optionalTrimmedString(field(formData, "payload", "payload")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

