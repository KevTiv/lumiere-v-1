/** Auto-generated Create*Params mappers for purchasing coverage gap. */

import type {
  CreateConsignmentAgreementParams,
  CreatePurchaseBlanketOrderParams,
  CreatePurchaseBlanketOrderLineParams,
  CreatePurchaseContractParams,
  CreatePurchaseRequisitionLineParams,
  CreatePurchaseReturnLineParams,
  CreatePurchaseReturnParams,
  CreatePurchaseRfqBidParams,
  CreatePurchaseRfqLineParams,
  CreatePurchaseRfqParams,
  CreatePurchasingIntegrationIntentParams,
  CreateVendorCreditFromPurchaseReturnParams,
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
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreatePurchaseRequisitionLineParams(
  formData: Record<string, unknown>,
): CreatePurchaseRequisitionLineParams | null {
  const productId = optionalBigIntU64(field(formData, "productId", "product_id"))
  if (productId === undefined) return null

  const productUom = optionalBigIntU64(field(formData, "productUom", "product_uom"))
  if (productUom === undefined) return null

  return {
    productId,
    productUom,
    productUomQty: num(field(formData, "productUomQty", "product_uom_qty"), 0),
    name: optionalTrimmedString(field(formData, "name", "name")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
  }
}

export function toCreatePurchaseReturnLineParams(
  formData: Record<string, unknown>,
): CreatePurchaseReturnLineParams | null {
  const productId = optionalBigIntU64(field(formData, "productId", "product_id"))
  if (productId === undefined) return null

  const productUom = optionalBigIntU64(field(formData, "productUom", "product_uom"))
  if (productUom === undefined) return null

  return {
    purchaseOrderLineId: optionalBigIntU64(field(formData, "purchaseOrderLineId", "purchase_order_line_id")),
    productId,
    productUom,
    productUomQty: num(field(formData, "productUomQty", "product_uom_qty"), 0),
    priceUnit: num(field(formData, "priceUnit", "price_unit"), 0),
    toRefund: Boolean(field(formData, "toRefund", "to_refund")),
  }
}

export function toCreatePurchaseRfqBidParams(
  formData: Record<string, unknown>,
): CreatePurchaseRfqBidParams | null {
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (partnerId === undefined || currencyId === undefined) return null

  return {
    partnerId,
    currencyId,
    priceUnit: num(field(formData, "priceUnit", "price_unit"), 0),
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
  }
}

export function toCreatePurchaseRfqLineParams(
  formData: Record<string, unknown>,
): CreatePurchaseRfqLineParams | null {
  const productId = optionalBigIntU64(field(formData, "productId", "product_id"))
  if (productId === undefined) return null

  const productUom = optionalBigIntU64(field(formData, "productUom", "product_uom"))
  if (productUom === undefined) return null

  return {
    productId,
    productUom,
    productUomQty: num(field(formData, "productUomQty", "product_uom_qty"), 0),
    name: optionalTrimmedString(field(formData, "name", "name")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
  }
}

export function toCreateConsignmentAgreementParams(
  formData: Record<string, unknown>,
): CreateConsignmentAgreementParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  const productId = optionalBigIntU64(field(formData, "productId", "product_id"))
  if (!name || partnerId === undefined || productId === undefined) return null

  const warehouseId = optionalBigIntU64(field(formData, "warehouseId", "warehouse_id"))
  if (warehouseId === undefined) return null

  return {
    name,
    partnerId,
    productId,
    warehouseId,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePurchaseBlanketOrderLineParams(
  formData: Record<string, unknown>,
): CreatePurchaseBlanketOrderLineParams | null {
  const productId = requiredFk(field(formData, "productId", "product_id"))
  const productUom = requiredFk(field(formData, "productUom", "product_uom"))
  const committedQuantity = Number(field(formData, "committedQuantity", "committed_quantity"))
  const priceUnit = Number(field(formData, "priceUnit", "price_unit"))
  if (
    productId === undefined ||
    productUom === undefined ||
    !Number.isFinite(committedQuantity) ||
    !Number.isFinite(priceUnit) ||
    committedQuantity <= 0 ||
    priceUnit < 0
  ) {
    return null
  }

  return {
    productId,
    productUom,
    committedQuantity,
    priceUnit,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePurchaseBlanketOrderParams(
  formData: Record<string, unknown>,
): CreatePurchaseBlanketOrderParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const partnerId = requiredFk(field(formData, "partnerId", "partner_id"))
  const currencyId = requiredFk(field(formData, "currencyId", "currency_id"))
  if (!name || partnerId === undefined || currencyId === undefined) return null

  const rawLines = field(formData, "lines", "lines")
  if (!Array.isArray(rawLines) || rawLines.length === 0) return null
  const lines: CreatePurchaseBlanketOrderLineParams[] = []
  for (const rawLine of rawLines) {
    const line = toCreatePurchaseBlanketOrderLineParams(
      (rawLine ?? {}) as Record<string, unknown>,
    )
    if (line == null) return null
    lines.push(line)
  }

  return {
    name,
    partnerId,
    currencyId,
    dateStart: optionalTimestampFromForm(field(formData, "dateStart", "date_start")),
    dateEnd: optionalTimestampFromForm(field(formData, "dateEnd", "date_end")),
    lines,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePurchaseContractParams(
  formData: Record<string, unknown>,
): CreatePurchaseContractParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  if (!name || partnerId === undefined) return null

  return {
    name,
    partnerId,
    dateStart: optionalTimestampFromForm(field(formData, "dateStart", "date_start")),
    dateEnd: optionalTimestampFromForm(field(formData, "dateEnd", "date_end")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePurchaseReturnParams(
  formData: Record<string, unknown>,
): CreatePurchaseReturnParams | null {
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  if (partnerId === undefined) return null

  const rawLines = field(formData, "lines", "lines")
  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((item: unknown) =>
      toCreatePurchaseReturnLineParams((item ?? {}) as Record<string, unknown>),
    )
    .filter((x): x is CreatePurchaseReturnLineParams => x != null)

  return {
    lines,
    purchaseOrderId: optionalBigIntU64(field(formData, "purchaseOrderId", "purchase_order_id")),
    partnerId,
    returnReason: optionalTrimmedString(field(formData, "returnReason", "return_reason")),
  }
}

export function toCreatePurchaseRfqParams(
  formData: Record<string, unknown>,
): CreatePurchaseRfqParams | null {
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (currencyId === undefined) return null

  const rawLines = field(formData, "lines", "lines")
  const lines = (Array.isArray(rawLines) ? rawLines : [])
    .map((item: unknown) =>
      toCreatePurchaseRfqLineParams((item ?? {}) as Record<string, unknown>),
    )
    .filter((x): x is CreatePurchaseRfqLineParams => x != null)

  return {
    lines,
    requisitionId: optionalBigIntU64(field(formData, "requisitionId", "requisition_id")),
    currencyId,
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePurchasingIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreatePurchasingIntegrationIntentParams | null {
  const provider = optionalTrimmedString(field(formData, "provider", "provider"))
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  if (!provider || !intentType || !idempotencyKey) return null

  return {
    provider,
    intentType,
    purchaseOrderId: optionalBigIntU64(field(formData, "purchaseOrderId", "purchase_order_id")),
    idempotencyKey,
    requestPayload: optionalTrimmedString(field(formData, "requestPayload", "request_payload")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

function requiredFk(v: unknown): bigint | undefined {
  const id = optionalBigIntU64(v)
  return id === undefined || id === 0n ? undefined : id
}

export function toCreateVendorCreditFromPurchaseReturnParams(
  formData: Record<string, unknown>,
): CreateVendorCreditFromPurchaseReturnParams | null {
  const journalId = requiredFk(field(formData, "journalId", "journal_id"))
  if (journalId === undefined) return null

  const expenseAccountId = requiredFk(field(formData, "expenseAccountId", "expense_account_id"))
  const payableAccountId = requiredFk(field(formData, "payableAccountId", "payable_account_id"))
  if (expenseAccountId === undefined || payableAccountId === undefined) return null

  return {
    journalId,
    expenseAccountId,
    payableAccountId,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
