/** Auto-generated Create*Params mappers for payments coverage gap. */

import type {
  CreatePaymentAccountParams,
  CreatePaymentFeeParams,
  CreatePaymentTransactionParams,
  PartnerType,
  PaymentDirection,
  PaymentFeeBearer,
  PaymentProviderCode,
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

export function toCreatePaymentAccountParams(
  formData: Record<string, unknown>,
): CreatePaymentAccountParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (!name || currencyId === undefined) return null

  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const accountJournalId = optionalBigIntU64(field(formData, "accountJournalId", "account_journal_id"))
  if (companyId === undefined || accountJournalId === undefined) return null

  return {
    providerCode: unitEnumFromForm<PaymentProviderCode>(field(formData, "providerCode", "provider_code"), ["Mtn", "Orange", "Airtel", "Mpesa", "Moov", "Wave", "Cash", "Bank", "Other"] as const, "Mtn"),
    companyId,
    name,
    providerLabel: optionalTrimmedString(field(formData, "providerLabel", "provider_label")),
    referenceRaw: optionalTrimmedString(field(formData, "referenceRaw", "reference_raw")),
    currencyId,
    accountJournalId,
    feeAccountId: optionalBigIntU64(field(formData, "feeAccountId", "fee_account_id")),
    clearingAccountId: optionalBigIntU64(field(formData, "clearingAccountId", "clearing_account_id")),
    isPrimary: Boolean(field(formData, "isPrimary", "is_primary")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePaymentFeeParams(
  formData: Record<string, unknown>,
): CreatePaymentFeeParams | null {
  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const paymentTransactionId = optionalBigIntU64(field(formData, "paymentTransactionId", "payment_transaction_id"))
  if (companyId === undefined || paymentTransactionId === undefined) return null

  return {
    bearer: unitEnumFromForm<PaymentFeeBearer>(field(formData, "bearer", "bearer"), ["Company", "Customer", "Supplier"] as const, "Company"),
    companyId,
    paymentTransactionId,
    amount: num(field(formData, "amount", "amount"), 0),
    feeAccountId: optionalBigIntU64(field(formData, "feeAccountId", "fee_account_id")),
    taxAccountId: optionalBigIntU64(field(formData, "taxAccountId", "tax_account_id")),
    taxAmount: num(field(formData, "taxAmount", "tax_amount"), 0),
    providerReference: optionalTrimmedString(field(formData, "providerReference", "provider_reference")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePaymentTransactionParams(
  formData: Record<string, unknown>,
): CreatePaymentTransactionParams | null {
  const partnerId = optionalBigIntU64(field(formData, "partnerId", "partner_id"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (partnerId === undefined || currencyId === undefined) return null

  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const paymentAccountId = optionalBigIntU64(field(formData, "paymentAccountId", "payment_account_id"))
  if (companyId === undefined || paymentAccountId === undefined) return null

  return {
    direction: unitEnumFromForm<PaymentDirection>(field(formData, "direction", "direction"), ["Inbound", "Outbound"] as const, "Inbound"),
    partnerType: unitEnumFromForm<PartnerType>(field(formData, "partnerType", "partner_type"), ["Customer", "Supplier"] as const, "Customer"),
    companyId,
    paymentAccountId,
    partnerId,
    externalReference: optionalTrimmedString(field(formData, "externalReference", "external_reference")),
    grossExternalAmount: num(field(formData, "grossExternalAmount", "gross_external_amount"), 0),
    settlementAmount: num(field(formData, "settlementAmount", "settlement_amount"), 0),
    netAccountAmount: num(field(formData, "netAccountAmount", "net_account_amount"), 0),
    currencyId,
    occurredAt: optionalTimestampFromForm(field(formData, "occurredAt", "occurred_at")),
    sourceEntity: optionalTrimmedString(field(formData, "sourceEntity", "source_entity")),
    sourceEntityId: optionalBigIntU64(field(formData, "sourceEntityId", "source_entity_id")),
    evidenceDocumentIds: u64IdArrayFromForm(field(formData, "evidenceDocumentIds", "evidence_document_ids")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
