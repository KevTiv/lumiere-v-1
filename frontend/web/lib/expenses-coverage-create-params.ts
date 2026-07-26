/** Auto-generated Create*Params mappers for expenses coverage gap. */

import type {
  CreateExpenseAdvanceParams,
  CreateExpenseCardStatementLineParams,
  CreateExpenseIntegrationIntentParams,
  CreateExpenseProjectRebillParams,
  CreateExpenseReceiptParams,
  CreateExpenseReimbursementParams,
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

function requiredFk(v: unknown): bigint | undefined {
  const id = optionalBigIntU64(v)
  return id === undefined || id === 0n ? undefined : id
}

export function toCreateExpenseCardStatementLineParams(
  formData: Record<string, unknown>,
): CreateExpenseCardStatementLineParams | null {
  const currencyId = requiredFk(field(formData, "currencyId", "currency_id"))
  if (currencyId === undefined) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    externalRef: optionalTrimmedString(field(formData, "externalRef", "external_ref")) ?? "",
    merchantKey: optionalTrimmedString(field(formData, "merchantKey", "merchant_key")),
    amount: num(field(formData, "amount", "amount"), 0),
    currencyId,
    transactionDate: requiredTimestampFromForm(field(formData, "transactionDate", "transaction_date")) ?? stbTimestampFromDate(new Date()),
    fxFeeAmount: num(field(formData, "fxFeeAmount", "fx_fee_amount"), 0),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateExpenseAdvanceParams(
  formData: Record<string, unknown>,
): CreateExpenseAdvanceParams | null {
  const employeeId = requiredFk(field(formData, "employeeId", "employee_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const currencyId = requiredFk(field(formData, "currencyId", "currency_id"))
  if (employeeId === undefined || !name || currencyId === undefined) return null

  const journalId = requiredFk(field(formData, "journalId", "journal_id"))
  const cashAccountId = requiredFk(field(formData, "cashAccountId", "cash_account_id"))
  const advanceAccountId = requiredFk(field(formData, "advanceAccountId", "advance_account_id"))
  if (journalId === undefined || cashAccountId === undefined || advanceAccountId === undefined) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    employeeId,
    name,
    amount: num(field(formData, "amount", "amount"), 0),
    currencyId,
    journalId,
    cashAccountId,
    advanceAccountId,
    accountingDate: requiredTimestampFromForm(field(formData, "accountingDate", "accounting_date")) ?? stbTimestampFromDate(new Date()),
    clientRequestId: optionalTrimmedString(field(formData, "clientRequestId", "client_request_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateExpenseIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateExpenseIntegrationIntentParams | null {
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  if (!intentType || !idempotencyKey || !payload) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    intentType,
    idempotencyKey,
    deviceId: optionalTrimmedString(field(formData, "deviceId", "device_id")),
    payload,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateExpenseProjectRebillParams(
  formData: Record<string, unknown>,
): CreateExpenseProjectRebillParams | null {
  const journalId = requiredFk(field(formData, "journalId", "journal_id"))
  if (journalId === undefined) return null

  const receivableAccountId = requiredFk(field(formData, "receivableAccountId", "receivable_account_id"))
  const incomeAccountId = requiredFk(field(formData, "incomeAccountId", "income_account_id"))
  if (receivableAccountId === undefined || incomeAccountId === undefined) return null

  return {
    journalId,
    receivableAccountId,
    incomeAccountId,
    invoiceDate: requiredTimestampFromForm(field(formData, "invoiceDate", "invoice_date")) ?? stbTimestampFromDate(new Date()),
    partnerId: optionalBigIntU64(field(formData, "partnerId", "partner_id")),
    fiscalPositionId: optionalBigIntU64(field(formData, "fiscalPositionId", "fiscal_position_id")),
    clientRequestId: optionalTrimmedString(field(formData, "clientRequestId", "client_request_id")),
  }
}

export function toCreateExpenseReceiptParams(
  formData: Record<string, unknown>,
): CreateExpenseReceiptParams | null {
  const employeeId = requiredFk(field(formData, "employeeId", "employee_id"))
  const storageKey = optionalTrimmedString(field(formData, "storageKey", "storage_key"))
  if (employeeId === undefined || !storageKey) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    employeeId,
    fileName: optionalTrimmedString(field(formData, "fileName", "file_name")),
    mimeType: optionalTrimmedString(field(formData, "mimeType", "mime_type")),
    storageKey,
    contentHash: optionalTrimmedString(field(formData, "contentHash", "content_hash")),
    clientRequestId: optionalTrimmedString(field(formData, "clientRequestId", "client_request_id")),
  }
}

export function toCreateExpenseReimbursementParams(
  formData: Record<string, unknown>,
): CreateExpenseReimbursementParams | null {
  const journalId = requiredFk(field(formData, "journalId", "journal_id"))
  if (journalId === undefined) return null

  const liquidityAccountId = requiredFk(field(formData, "liquidityAccountId", "liquidity_account_id"))
  const payableAccountId = requiredFk(field(formData, "payableAccountId", "payable_account_id"))
  if (liquidityAccountId === undefined || payableAccountId === undefined) return null

  return {
    journalId,
    liquidityAccountId,
    payableAccountId,
    paymentDate: requiredTimestampFromForm(field(formData, "paymentDate", "payment_date")) ?? stbTimestampFromDate(new Date()),
    amount: num(field(formData, "amount", "amount"), 0),
    clientRequestId: optionalTrimmedString(field(formData, "clientRequestId", "client_request_id")),
  }
}

