/** Auto-generated Create*Params mappers for subscriptions coverage gap. */

import type {
  CreateSubscriptionBundleParams,
  CreateSubscriptionPaymentIntentParams,
  CreateSubscriptionTaxSettleIntentParams,
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

export function toCreateSubscriptionBundleParams(
  formData: Record<string, unknown>,
): CreateSubscriptionBundleParams | null {
  const planId = optionalBigIntU64(field(formData, "planId", "plan_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const code = optionalTrimmedString(field(formData, "code", "code"))
  if (planId === undefined || !name || !code) return null

  return {
    planId,
    name,
    code,
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSubscriptionPaymentIntentParams(
  formData: Record<string, unknown>,
): CreateSubscriptionPaymentIntentParams | null {
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (!intentType || !idempotencyKey || currencyId === undefined) return null

  return {
    intentType,
    idempotencyKey,
    invoiceMoveId: optionalBigIntU64(field(formData, "invoiceMoveId", "invoice_move_id")),
    paymentTokenId: optionalBigIntU64(field(formData, "paymentTokenId", "payment_token_id")),
    amount: num(field(formData, "amount", "amount"), 0),
    currencyId,
    fallbackDraftInvoice: Boolean(field(formData, "fallbackDraftInvoice", "fallback_draft_invoice")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateSubscriptionTaxSettleIntentParams(
  formData: Record<string, unknown>,
): CreateSubscriptionTaxSettleIntentParams | null {
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const packCode = optionalTrimmedString(field(formData, "packCode", "pack_code"))
  if (!intentType || !idempotencyKey || !packCode) return null

  return {
    intentType,
    idempotencyKey,
    invoiceMoveId: optionalBigIntU64(field(formData, "invoiceMoveId", "invoice_move_id")) ?? 0n,
    paymentId: optionalBigIntU64(field(formData, "paymentId", "payment_id")),
    packCode,
    payload: optionalTrimmedString(field(formData, "payload", "payload")) ?? "",
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

