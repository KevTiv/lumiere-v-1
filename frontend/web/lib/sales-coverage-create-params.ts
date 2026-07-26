/** Auto-generated Create*Params mappers for sales coverage gap. */

import type {
  CreateFiscalPositionParams,
  CreateFiscalPositionTaxParams,
  CreateIncotermParams,
  CreateSaleCommissionPlanParams,
  CreateSaleCommissionPlanSplitParams,
  CreateSaleContractParams,
  CreateSaleCpqConstraintParams,
  CreateSaleOrderOptionParams,
  CreateSalePromotionParams,
  CreateSalesIntegrationIntentParams,
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

export function toCreateFiscalPositionTaxParams(
  formData: Record<string, unknown>,
): CreateFiscalPositionTaxParams | null {
  const fiscalPositionId = optionalBigIntU64(field(formData, "fiscalPositionId", "fiscal_position_id"))
  if (fiscalPositionId === undefined) return null

  const taxSrcId = optionalBigIntU64(field(formData, "taxSrcId", "tax_src_id"))
  if (taxSrcId === undefined) return null

  return {
    fiscalPositionId,
    taxSrcId,
    taxDestId: optionalBigIntU64(field(formData, "taxDestId", "tax_dest_id")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSaleCommissionPlanSplitParams(
  formData: Record<string, unknown>,
): CreateSaleCommissionPlanSplitParams | null {
  const planId = optionalBigIntU64(field(formData, "planId", "plan_id"))
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  if (planId === undefined || partnerId === undefined) return null

  return {
    planId,
    partnerId,
    sharePercent: num(field(formData, "sharePercent", "share_percent"), 0),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateFiscalPositionParams(
  formData: Record<string, unknown>,
): CreateFiscalPositionParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    name,
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateIncotermParams(
  formData: Record<string, unknown>,
): CreateIncotermParams | null {
  const code = optionalTrimmedString(field(formData, "code", "code"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!code || !name) return null

  return {
    code,
    name,
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSaleCommissionPlanParams(
  formData: Record<string, unknown>,
): CreateSaleCommissionPlanParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    name,
    isActive: field(formData, "isActive", "is_active") !== false,
    defaultRatePercent: num(field(formData, "defaultRatePercent", "default_rate_percent"), 0),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSaleContractParams(
  formData: Record<string, unknown>,
): CreateSaleContractParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  if (!name || partnerId === undefined) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    name,
    partnerId,
    dateStart: optionalTimestampFromForm(field(formData, "dateStart", "date_start")),
    dateEnd: optionalTimestampFromForm(field(formData, "dateEnd", "date_end")),
    pricelistId: optionalBigIntU64(field(formData, "pricelistId", "pricelist_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSaleCpqConstraintParams(
  formData: Record<string, unknown>,
): CreateSaleCpqConstraintParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const ruleJson = optionalTrimmedString(field(formData, "ruleJson", "rule_json"))
  if (!name || !ruleJson) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    name,
    ruleJson,
    isActive: field(formData, "isActive", "is_active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSaleOrderOptionParams(
  formData: Record<string, unknown>,
): CreateSaleOrderOptionParams | null {
  const productId = optionalBigIntU64(field(formData, "productId", "product_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (productId === undefined || !name) return null

  const uomId = optionalBigIntU64(field(formData, "uomId", "uom_id"))
  if (uomId === undefined) return null

  return {
    productId,
    name,
    quantity: num(field(formData, "quantity", "quantity"), 0),
    uomId,
    priceUnit: num(field(formData, "priceUnit", "price_unit"), 0),
    discount: num(field(formData, "discount", "discount"), 0),
    isPresent: Boolean(field(formData, "isPresent", "is_present")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSalePromotionParams(
  formData: Record<string, unknown>,
): CreateSalePromotionParams | null {
  const code = optionalTrimmedString(field(formData, "code", "code"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!code || !name) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    code,
    name,
    discountPercent: num(field(formData, "discountPercent", "discount_percent"), 0),
    discountFixed: num(field(formData, "discountFixed", "discount_fixed"), 0),
    minAmount: num(field(formData, "minAmount", "min_amount"), 0),
    isActive: field(formData, "isActive", "is_active") !== false,
    dateStart: optionalTimestampFromForm(field(formData, "dateStart", "date_start")),
    dateEnd: optionalTimestampFromForm(field(formData, "dateEnd", "date_end")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSalesIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateSalesIntegrationIntentParams | null {
  const provider = optionalTrimmedString(field(formData, "provider", "provider"))
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  if (!provider || !intentType || !idempotencyKey) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    provider,
    intentType,
    saleOrderId: optionalBigIntU64(field(formData, "saleOrderId", "sale_order_id")),
    idempotencyKey,
    requestPayload: optionalTrimmedString(field(formData, "requestPayload", "request_payload")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

