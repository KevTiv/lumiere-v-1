/**
 * Maps Accounting module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateAccountAccountParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
} from '@lumiere/stdb'
import { Timestamp } from 'spacetimedb'

import { userTypeIdFromInternalGroup } from '@/lib/accounting-defaults'
import { stdbParamsToJson } from '@/lib/stdb-params-json'

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function optionalBigIntU64(v: unknown): bigint | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'bigint') return v
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0) return BigInt(Math.trunc(n))
  try {
    return BigInt(String(v).trim())
  } catch {
    return undefined
  }
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function timestampFromFormDate(v: unknown, fallback = new Date()): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d)
  }
  return Timestamp.fromDate(fallback)
}

function optionalTimestampFromFormDate(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return Timestamp.fromDate(d)
}

function capitalizeTag(raw: unknown): string {
  const s = String(raw ?? '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toInternalType(
  raw: unknown,
): CreateAccountAccountParams['internalType'] {
  if (raw == null || raw === '') return undefined
  const tag = capitalizeTag(raw)
  switch (tag) {
    case 'Receivable':
    case 'Payable':
    case 'Liquidity':
    case 'Asset':
    case 'Equity':
    case 'Liability':
    case 'Income':
    case 'Expense':
    case 'Other':
      return { tag }
    default:
      return undefined
  }
}

function toInternalGroup(
  raw: unknown,
): CreateAccountAccountParams['internalGroup'] {
  if (raw == null || raw === '') return undefined
  const tag = capitalizeTag(raw)
  switch (tag) {
    case 'Asset':
    case 'Liability':
    case 'Equity':
    case 'Income':
    case 'Expense':
    case 'Other':
      return { tag }
    default:
      return undefined
  }
}

export function toCreateAccountAccountParams(
  formData: Record<string, unknown>,
): CreateAccountAccountParams | null {
  const rawUt = formData.userTypeId
  let userTypeId: bigint | null =
    rawUt != null && rawUt !== ''
      ? requiredBigIntU64(rawUt)
      : (userTypeIdFromInternalGroup(String(formData.internalGroup ?? '')) ?? null)
  if (userTypeId == null) return null

  return {
    companyId: undefined,
    code: String(formData.code ?? ''),
    name: String(formData.name ?? ''),
    userTypeId,
    currencyId: optionalBigIntU64(formData.currencyId),
    internalType: toInternalType(formData.internalType),
    internalGroup: toInternalGroup(formData.internalGroup),
    groupId: optionalBigIntU64(formData.groupId),
    reconcile: Boolean(formData.reconcile),
    taxIds: [],
    note: optionalTrimmedString(formData.note),
    openingDebit: Number(formData.openingDebit ?? 0),
    openingCredit: Number(formData.openingCredit ?? 0),
    allowedJournalIds: [],
    nonTrade: false,
    isOffBalance: false,
    metadata: undefined,
  }
}

const MOVE_TYPE_ENTRY: CreateAccountMoveParams['moveType'] = { tag: 'Entry' }
const MOVE_TYPE_OUT_INVOICE: CreateAccountMoveParams['moveType'] = { tag: 'OutInvoice' }
const MOVE_TYPE_IN_INVOICE: CreateAccountMoveParams['moveType'] = { tag: 'InInvoice' }

export function toCreateJournalEntryMoveParams(
  formData: Record<string, unknown>,
): CreateAccountMoveParams | null {
  const journalId = requiredBigIntU64(formData.journalId)
  if (journalId == null) return null

  return {
    companyId: undefined,
    journalId,
    moveType: MOVE_TYPE_ENTRY,
    date: timestampFromFormDate(formData.date ?? new Date().toISOString()),
    name: String(formData.name ?? formData.ref ?? 'Journal Entry'),
    ref: optionalTrimmedString(formData.ref),
    autoPost: false,
    toCheck: false,
    isStorno: false,
    partnerId: optionalBigIntU64(formData.partnerId),
    partnerBankId: undefined,
    fiscalPositionId: undefined,
    invoiceDate: optionalTimestampFromFormDate(formData.invoiceDate),
    invoiceDateDue: optionalTimestampFromFormDate(formData.invoiceDateDue),
    invoicePaymentTermId: optionalBigIntU64(formData.invoicePaymentTermId),
    paymentReference: undefined,
    invoiceOrigin: undefined,
    invoicePartnerDisplayName: optionalTrimmedString(formData.partner),
    invoiceCashRoundingId: undefined,
    partnerShippingId: undefined,
    saleOrderId: undefined,
    invoiceIncotermId: undefined,
    incotermLocation: undefined,
    campaignId: undefined,
    sourceId: undefined,
    mediumId: undefined,
    secureSequenceNumber: undefined,
    metadata: optionalTrimmedString(formData.narration),
  }
}

/** Params from `CreateInvoiceModal` / bill modal `onSave` plus resolved `journalId`. */
export function toCreateAccountMoveFromInvoiceModal(
  params: Record<string, unknown>,
  kind: 'OutInvoice' | 'InInvoice',
  journalId: bigint,
  defaultName: string,
): CreateAccountMoveParams {
  const moveType =
    kind === 'OutInvoice' ? MOVE_TYPE_OUT_INVOICE : MOVE_TYPE_IN_INVOICE

  return {
    companyId: undefined,
    journalId,
    moveType,
    date: timestampFromFormDate(
      params.date ?? params.invoiceDate ?? new Date().toISOString(),
    ),
    name: String(params.name ?? params.ref ?? defaultName),
    ref: optionalTrimmedString(params.ref),
    autoPost: false,
    toCheck: false,
    isStorno: false,
    partnerId: optionalBigIntU64(params.partnerId),
    partnerBankId: undefined,
    fiscalPositionId: undefined,
    invoiceDate: optionalTimestampFromFormDate(params.invoiceDate),
    invoiceDateDue: optionalTimestampFromFormDate(params.invoiceDateDue),
    invoicePaymentTermId: optionalBigIntU64(params.invoicePaymentTermId),
    paymentReference: undefined,
    invoiceOrigin: undefined,
    invoicePartnerDisplayName: optionalTrimmedString(
      params.invoicePartnerDisplayName ?? params.partner,
    ),
    invoiceCashRoundingId: undefined,
    partnerShippingId: undefined,
    saleOrderId: undefined,
    invoiceIncotermId: undefined,
    incotermLocation: undefined,
    campaignId: undefined,
    sourceId: undefined,
    mediumId: undefined,
    secureSequenceNumber: undefined,
    metadata:
      optionalTrimmedString(params.metadata) ?? optionalTrimmedString(params.narration),
  }
}

function toTypeTaxUse(raw: string): CreateAccountTaxParams['typeTaxUse'] {
  if (raw === 'purchase') return { tag: 'Purchase' }
  if (raw === 'none') return { tag: 'None' }
  return { tag: 'Sale' }
}

function toAmountType(raw: string): CreateAccountTaxParams['amountType'] {
  if (raw === 'fixed') return { tag: 'Fixed' }
  if (raw === 'division') return { tag: 'Division' }
  if (raw === 'python_code') return { tag: 'PythonCode' }
  return { tag: 'Percent' }
}

export function toCreateAccountTaxParams(
  formData: Record<string, unknown>,
): CreateAccountTaxParams {
  const typeTaxUse = String(formData.typeTaxUse ?? 'sale')
  const amountType = String(formData.amountType ?? 'percent')

  return {
    name: String(formData.name ?? ''),
    description: optionalTrimmedString(formData.description),
    typeTaxUse: toTypeTaxUse(typeTaxUse),
    amountType: toAmountType(amountType),
    amount: Number(formData.amount ?? 0),
    active: true,
    priceInclude: Boolean(formData.priceInclude),
    includeBaseAmount: false,
    isBaseAffected: false,
    sequence: Number(formData.sequence ?? 1),
    taxGroupId: optionalBigIntU64(formData.taxGroupId),
    countryId: optionalBigIntU64(formData.countryId),
    countryCode: optionalTrimmedString(formData.countryCode),
    tags: [],
    hasNegativeFactor: false,
    invoiceRepartitionLineIds: [],
    refundRepartitionLineIds: [],
    metadata: undefined,
  }
}

const BUDGET_STATE_DRAFT: CreateCrossoveredBudgetParams['state'] = { tag: 'Draft' }

export function toCreateCrossoveredBudgetParams(
  formData: Record<string, unknown>,
): CreateCrossoveredBudgetParams {
  return {
    companyId: undefined,
    name: String(formData.name ?? ''),
    description: optionalTrimmedString(formData.description),
    dateFrom: timestampFromFormDate(formData.dateFrom ?? new Date().toISOString()),
    dateTo: timestampFromFormDate(formData.dateTo ?? new Date().toISOString()),
    state: BUDGET_STATE_DRAFT,
    crossoveredBudgetLine: [],
    totalPlanned: Number(formData.totalPlanned ?? 0),
    totalPractical: 0,
    totalTheoretical: 0,
    variancePercentage: 0,
    metadata: undefined,
  }
}

export function accountingParamsToJson(
  params:
    | CreateAccountAccountParams
    | CreateAccountMoveParams
    | CreateAccountTaxParams
    | CreateCrossoveredBudgetParams,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}
