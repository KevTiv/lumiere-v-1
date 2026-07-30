/**
 * Maps Accounting module form payloads to SpacetimeDB reducer param types.
 */

import type {
  AssetType,
  CreateAccountAccountParams,
  CreateAccountAccountTypeParams,
  CreateAccountAssetParams,
  CreateAccountBankStatementLineParams,
  CreateAccountBankStatementParams,
  CreateAccountGroupParams,
  CreateAccountJournalParams,
  CreateAccountMoveParams,
  CreateAccountPeriodParams,
  CreateAccountReconciliationWidgetParams,
  CreateAccountTaxParams,
  CreateAnalyticAccountParams,
  CreateAnalyticDistributionModelParams,
  CreateConsolidationAccountParams,
  CreateConsolidationJournalParams,
  CreateCreditNoteParams,
  CreateCrossoveredBudgetLineParams,
  CreateAnalyticLineParams,
  CreateBudgetPostParams,
  CreateCrossoveredBudgetParams,
  CreateCurrencyRateParams,
  CreateEliminationEntryParams,
  CreateFiscalYearParams,
  CreatePaymentParams,
  CreatePaymentTermLineParams,
  CreatePaymentTermParams,
  DepreciationMethod,
  UpdateAccountAccountTypeParams,
  UpdateAccountGroupParams,
  UpdateAnalyticAccountParams,
  UpdateAnalyticDistributionModelParams,
  UpdateAnalyticLineParams,
  UpdateBudgetPostParams,
} from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { userTypeIdFromAccountTypes } from "./accounting-defaults"
import {
  formValue as field,
  optionalBigIntU64,
  parseDelimitedU64Ids,
  u64IdArrayFromForm,
} from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"
import { encodeTaggedUnitEnum, stdbParamsToJson } from "./stdb-params-json"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function hasOwn(formData: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(formData, key)
}

function nullableTrimmedString(v: unknown): string | null {
  if (v == null) return null
  const value = String(v).trim()
  return value === '' ? null : value
}

function nullableBigIntU64(v: unknown): bigint | null {
  if (v == null || String(v).trim() === '') return null
  return optionalBigIntU64(v) ?? null
}

/**
 * Generated `Infer` collapses `Option<Option<T>>` to `T | undefined`, so clear
 * (`null`) is not representable on the official type. Patch builders keep
 * runtime `null` for clear and omit keys for preserve.
 */
type ClearablePatch<T> = {
  [K in keyof T]?: T[K] | null
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function timestampFromFormDate(v: unknown): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  throw new Error('A valid business date is required')
}

function optionalTimestampFromFormDate(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
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
  opts: { companyId: bigint; accountTypes?: ReadonlyArray<Record<string, unknown>> },
): CreateAccountAccountParams | null {
  const rawUt = formData.userTypeId
  let userTypeId: bigint | null =
    rawUt != null && rawUt !== "" ? requiredBigIntU64(rawUt) : null

  if (userTypeId == null && opts?.accountTypes?.length) {
    userTypeId =
      userTypeIdFromAccountTypes(opts.accountTypes, String(formData.internalGroup ?? "")) ?? null
  }

  // Fail closed: never invent fixed account-type IDs 1..6.
  if (userTypeId == null) return null

  return {
    companyId: opts.companyId,
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
    metadata: optionalTrimmedString(formData.metadata),
  }
}

const MOVE_TYPE_ENTRY: CreateAccountMoveParams['moveType'] = { tag: 'Entry' }
const MOVE_TYPE_OUT_INVOICE: CreateAccountMoveParams['moveType'] = { tag: 'OutInvoice' }
const MOVE_TYPE_IN_INVOICE: CreateAccountMoveParams['moveType'] = { tag: 'InInvoice' }

export function toCreateJournalEntryMoveParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateAccountMoveParams | null {
  const journalId = requiredBigIntU64(formData.journalId)
  if (journalId == null) return null

  return {
    idempotencyKey: `create-account-move:${globalThis.crypto.randomUUID()}`,
    companyId,
    journalId,
    moveType: MOVE_TYPE_ENTRY,
    date: timestampFromFormDate(formData.date),
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
  companyId: bigint,
): CreateAccountMoveParams {
  const moveType =
    kind === 'OutInvoice' ? MOVE_TYPE_OUT_INVOICE : MOVE_TYPE_IN_INVOICE

  return {
    idempotencyKey: `create-account-move:${globalThis.crypto.randomUUID()}`,
    companyId,
    journalId,
    moveType,
    date: timestampFromFormDate(params.date ?? params.invoiceDate),
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
    metadata: optionalTrimmedString(formData.metadata),
  }
}

const MAX_SAFE_U64_JSON = BigInt(Number.MAX_SAFE_INTEGER)

function bigintToSafeJsonU64(b: bigint): number {
  if (b < 0n) {
    throw new Error(`u64 JSON: negative bigint ${b}`)
  }
  if (b > MAX_SAFE_U64_JSON) {
    throw new Error(
      `u64 JSON: bigint ${b} exceeds Number.MAX_SAFE_INTEGER; cannot send exact value in JSON`,
    )
  }
  return Number(b)
}

/** SATS unit-variant sum JSON for SpacetimeDB HTTP (keys are camelCase, e.g. `{ "percent": [] }`). */
function stdbTaggedUnitEnumToHttpSumJson(v: { tag: string }): Record<string, unknown> {
  return encodeTaggedUnitEnum(v)
}

function u64BigintArrayToHttpJson(ids: readonly bigint[]): number[] {
  return ids.map(bigintToSafeJsonU64)
}

function optionalBigintU64ToHttpJson(b: bigint | undefined): number | null {
  if (b === undefined) return null
  return bigintToSafeJsonU64(b)
}

/**
 * `POST .../call/create_account_tax` expects JSON keys matching the Rust struct (snake_case), not
 * the generated TS client field names (camelCase). Use this instead of {@link stdbParamsToJson} for
 * {@link CreateAccountTaxParams}.
 */
export function createAccountTaxParamsToStdbHttpJson(
  params: CreateAccountTaxParams,
): Record<string, unknown> {
  const typeTaxUse = params.typeTaxUse as { tag: string }
  const amountType = params.amountType as { tag: string }

  return {
    name: params.name,
    description:
      params.description === undefined
        ? { none: [] }
        : { some: params.description },
    type_tax_use: stdbTaggedUnitEnumToHttpSumJson(typeTaxUse),
    amount_type: stdbTaggedUnitEnumToHttpSumJson(amountType),
    amount: params.amount,
    active: params.active,
    price_include: params.priceInclude,
    include_base_amount: params.includeBaseAmount,
    is_base_affected: params.isBaseAffected,
    sequence: params.sequence,
    tax_group_id: optionalBigintU64ToHttpJson(params.taxGroupId),
    country_id: optionalBigintU64ToHttpJson(params.countryId),
    country_code: params.countryCode ?? null,
    tags: u64BigintArrayToHttpJson(params.tags),
    has_negative_factor: params.hasNegativeFactor,
    invoice_repartition_line_ids: u64BigintArrayToHttpJson(params.invoiceRepartitionLineIds),
    refund_repartition_line_ids: u64BigintArrayToHttpJson(params.refundRepartitionLineIds),
    metadata: params.metadata ?? null,
  }
}

/** SpacetimeDB HTTP JSON for `Option<T>` (SATS `some` / `none`). */
function stdbOptionSome<T>(value: T): { some: T; none?: never } {
  return { some: value }
}

function stdbOptionNone(): { none: []; some?: never } {
  return { none: [] }
}

function optionTaggedEnumToHttpJson(
  v: { tag: string } | undefined,
): { some: Record<string, unknown> } | { none: [] } {
  if (v === undefined) return stdbOptionNone()
  return stdbOptionSome(stdbTaggedUnitEnumToHttpSumJson(v))
}

/**
 * `POST .../call/create_account_account` expects JSON keys matching the Rust struct (snake_case) and
 * SATS sum JSON for enums (`{"Other":[]}`), not generated TS field names (`userTypeId`, `{tag:…}`, …).
 */
export function createAccountAccountParamsToStdbHttpJson(
  params: CreateAccountAccountParams,
): Record<string, unknown> {
  const internalType = params.internalType as { tag: string } | undefined
  const internalGroup = params.internalGroup as { tag: string } | undefined

  return {
    company_id: optionalBigintU64ToHttpJson(params.companyId),
    code: params.code,
    name: params.name,
    user_type_id: bigintToSafeJsonU64(params.userTypeId),
    currency_id: optionalBigintU64ToHttpJson(params.currencyId),
    internal_type: optionTaggedEnumToHttpJson(internalType),
    internal_group: optionTaggedEnumToHttpJson(internalGroup),
    group_id: optionalBigintU64ToHttpJson(params.groupId),
    reconcile: params.reconcile,
    tax_ids: u64BigintArrayToHttpJson(params.taxIds),
    note: params.note ?? null,
    opening_debit: params.openingDebit,
    opening_credit: params.openingCredit,
    allowed_journal_ids: u64BigintArrayToHttpJson(params.allowedJournalIds),
    non_trade: params.nonTrade,
    is_off_balance: params.isOffBalance,
    metadata: params.metadata ?? null,
  }
}

export function toCreateCrossoveredBudgetParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateCrossoveredBudgetParams {
  return {
    companyId,
    name: String(formData.name ?? ''),
    description: optionalTrimmedString(formData.description),
    dateFrom: timestampFromFormDate(formData.dateFrom),
    dateTo: timestampFromFormDate(formData.dateTo),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

function parseAccountIdList(raw: unknown): bigint[] {
  return parseDelimitedU64Ids(raw)
}

/** When `tagIds` is absent from the form payload, do not change tags on update. */
function optionalTagIdsForAnalyticLineUpdate(
  formData: Record<string, unknown>,
): bigint[] | undefined {
  if (!('tagIds' in formData)) return undefined
  return u64IdArrayFromForm(formData.tagIds)
}

function analyticLineTagIdsForCreate(formData: Record<string, unknown>): bigint[] {
  if (!('tagIds' in formData)) return []
  return u64IdArrayFromForm(formData.tagIds)
}

function updateAccountGroupParentId(
  formData: Record<string, unknown>,
): bigint | null | undefined {
  if (!('parentId' in formData)) return undefined
  const raw = formData.parentId
  if (raw === '' || raw == null) {
    return null
  }
  return optionalBigIntU64(raw) ?? null
}

export function toCreateBudgetPostParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateBudgetPostParams {
  return {
    companyId,
    name: String(formData.name ?? '').trim(),
    code: optionalTrimmedString(formData.code),
    description: optionalTrimmedString(formData.description),
    accountIds: parseAccountIdList(formData.accountIds),
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateBudgetPostParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): Record<string, unknown> {
  const params: Record<string, unknown> = { companyId }
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'code')) params.code = nullableTrimmedString(formData.code)
  if (hasOwn(formData, 'description')) {
    params.description = nullableTrimmedString(formData.description)
  }
  if (hasOwn(formData, 'accountIds')) params.accountIds = parseAccountIdList(formData.accountIds)
  if (hasOwn(formData, 'isActive')) params.isActive = Boolean(formData.isActive)
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function toCreateAccountAccountTypeParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateAccountAccountTypeParams {
  return {
    name: String(formData.name ?? '').trim(),
    type: String(formData.type ?? '').trim(),
    internalGroup: toInternalGroup(formData.internalGroup) ?? { tag: 'Asset' },
    includeInitialBalance: Boolean(formData.includeInitialBalance),
    companyId,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountAccountTypeParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): Record<string, unknown> {
  const params: Record<string, unknown> = { companyId }
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'type')) params.type = optionalTrimmedString(formData.type)
  if (hasOwn(formData, 'internalGroup') && formData.internalGroup !== '') {
    params.internalGroup = toInternalGroup(formData.internalGroup)
  }
  if (hasOwn(formData, 'includeInitialBalance')) {
    params.includeInitialBalance = Boolean(formData.includeInitialBalance)
  }
  if (hasOwn(formData, 'isDeprecated')) {
    params.isDeprecated = Boolean(formData.isDeprecated)
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function toCreateAccountGroupParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateAccountGroupParams {
  const levelRaw = Number(formData.level ?? 0)
  return {
    name: String(formData.name ?? '').trim(),
    codePrefixStart: optionalTrimmedString(formData.codePrefixStart),
    codePrefixEnd: optionalTrimmedString(formData.codePrefixEnd),
    level: Number.isFinite(levelRaw) ? Math.max(0, Math.trunc(levelRaw)) : 0,
    parentId: optionalBigIntU64(formData.parentId),
    companyId,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

/** `parentId` on the form updates hierarchy; empty string clears the parent (inner none). */
export function toUpdateAccountGroupParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): Record<string, unknown> {
  const params: Record<string, unknown> = { companyId }
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'codePrefixStart')) {
    params.codePrefixStart = nullableTrimmedString(formData.codePrefixStart)
  }
  if (hasOwn(formData, 'codePrefixEnd')) {
    params.codePrefixEnd = nullableTrimmedString(formData.codePrefixEnd)
  }
  if (hasOwn(formData, 'level') && formData.level !== '' && formData.level != null) {
    params.level = Math.max(0, Math.trunc(Number(formData.level)))
  }
  params.parentId = updateAccountGroupParentId(formData)
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function accountingParamsToJson(
  params: object,
  structName: string,
): Record<string, unknown> {
  return stdbParamsToJson(params, structName as Parameters<typeof stdbParamsToJson>[1])
}

export function analyticParamsToJson(params: object, structName: string): Record<string, unknown> {
  return stdbParamsToJson(params, structName as Parameters<typeof stdbParamsToJson>[1])
}

export function toCreateAnalyticAccountParams(
  formData: Record<string, unknown>,
  defaultCurrencyId: bigint,
  companyId?: bigint,
): CreateAnalyticAccountParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null
  const currencyId = optionalBigIntU64(formData.currencyId) ?? defaultCurrencyId
  return {
    companyId,
    name,
    code: optionalTrimmedString(formData.code),
    active: formData.active !== false,
    currencyId,
    partnerId: optionalBigIntU64(formData.partnerId),
    planId: optionalBigIntU64(formData.planId),
    rootId: optionalBigIntU64(formData.rootId),
    groupId: optionalBigIntU64(formData.groupId),
    parentId: optionalBigIntU64(formData.parentId),
    color:
      formData.color != null && String(formData.color).trim() !== ''
        ? Number(formData.color)
        : undefined,
    isRequiredInMoveLines: Boolean(formData.isRequiredInMoveLines),
    isRequiredInDistribution: Boolean(formData.isRequiredInDistribution),
    isRootPlan: Boolean(formData.isRootPlan),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateAnalyticLineParams(
  formData: Record<string, unknown>,
  defaultCurrencyId: bigint,
): CreateAnalyticLineParams | null {
  const name = String(formData.name ?? '').trim()
  const accountId = optionalBigIntU64(formData.accountId)
  if (!name || accountId === undefined) return null
  return {
    name,
    description: optionalTrimmedString(formData.description),
    accountId,
    amount: Number(formData.amount ?? 0),
    unitAmount: Number(formData.unitAmount ?? formData.amount ?? 0),
    currencyId: optionalBigIntU64(formData.currencyId) ?? defaultCurrencyId,
    date: timestampFromFormDate(formData.date),
    partnerId: optionalBigIntU64(formData.partnerId),
    productId: optionalBigIntU64(formData.productId),
    productUomId: optionalBigIntU64(formData.productUomId),
    generalAccountId: optionalBigIntU64(formData.generalAccountId),
    moveId: optionalBigIntU64(formData.moveId),
    moveLineId: optionalBigIntU64(formData.moveLineId),
    paymentId: optionalBigIntU64(formData.paymentId),
    projectId: optionalBigIntU64(formData.projectId),
    taskId: optionalBigIntU64(formData.taskId),
    employeeId: optionalBigIntU64(formData.employeeId),
    timesheetInvoiceId: optionalBigIntU64(formData.timesheetInvoiceId),
    timesheetInvoiceType: optionalTrimmedString(formData.timesheetInvoiceType),
    sheetId: optionalBigIntU64(formData.sheetId),
    isTimesheet: Boolean(formData.isTimesheet),
    category: optionalTrimmedString(formData.category),
    tagIds: analyticLineTagIdsForCreate(formData),
    analyticRef: optionalTrimmedString(formData.analyticRef),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

/** Single analytic account @ 100% — matches server validation (total percentage = 100). */
export function toCreateAnalyticDistributionModelParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateAnalyticDistributionModelParams | null {
  const accountId = optionalBigIntU64(formData.analyticAccountId)
  if (accountId === undefined) return null
  const precRaw = Number(formData.analyticPrecision ?? 2)
  const analyticPrecision = Number.isFinite(precRaw)
    ? Math.min(255, Math.max(0, Math.trunc(precRaw)))
    : 2
  return {
    companyId,
    name: optionalTrimmedString(formData.name),
    partnerCategoryId: optionalBigIntU64(formData.partnerCategoryId),
    productId: optionalBigIntU64(formData.productId),
    productCategId: optionalBigIntU64(formData.productCategId),
    analyticDistribution: [{ accountId, percentage: 100 }],
    analyticPrecision,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAnalyticAccountParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): Record<string, unknown> {
  const params: Record<string, unknown> = { companyId }
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'code')) params.code = nullableTrimmedString(formData.code)
  if (hasOwn(formData, 'partnerId')) params.partnerId = nullableBigIntU64(formData.partnerId)
  if (hasOwn(formData, 'planId')) params.planId = nullableBigIntU64(formData.planId)
  if (hasOwn(formData, 'groupId')) params.groupId = nullableBigIntU64(formData.groupId)
  if (hasOwn(formData, 'color')) {
    params.color =
      formData.color == null || String(formData.color).trim() === ''
        ? null
        : Number(formData.color)
  }
  if (hasOwn(formData, 'isRequiredInMoveLines')) {
    params.isRequiredInMoveLines = Boolean(formData.isRequiredInMoveLines)
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function toUpdateAnalyticLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'amount') && formData.amount !== '' && formData.amount != null) {
    params.amount = Number(formData.amount)
  }
  if (hasOwn(formData, 'unitAmount') && formData.unitAmount !== '' && formData.unitAmount != null) {
    params.unitAmount = Number(formData.unitAmount)
  }
  if (hasOwn(formData, 'partnerId')) params.partnerId = nullableBigIntU64(formData.partnerId)
  if (hasOwn(formData, 'projectId')) params.projectId = nullableBigIntU64(formData.projectId)
  if (hasOwn(formData, 'taskId')) params.taskId = nullableBigIntU64(formData.taskId)
  if (hasOwn(formData, 'category')) params.category = nullableTrimmedString(formData.category)
  params.tagIds = optionalTagIdsForAnalyticLineUpdate(formData)
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function toUpdateAnalyticDistributionModelParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): ClearablePatch<UpdateAnalyticDistributionModelParams> {
  const params: ClearablePatch<UpdateAnalyticDistributionModelParams> = { companyId }
  if (hasOwn(formData, 'name')) params.name = nullableTrimmedString(formData.name)
  if (hasOwn(formData, 'partnerCategoryId')) {
    params.partnerCategoryId = nullableBigIntU64(formData.partnerCategoryId)
  }
  if (hasOwn(formData, 'productId')) params.productId = nullableBigIntU64(formData.productId)
  if (hasOwn(formData, 'productCategId')) {
    params.productCategId = nullableBigIntU64(formData.productCategId)
  }
  if (hasOwn(formData, 'analyticAccountId')) {
    const accountId = optionalBigIntU64(formData.analyticAccountId)
    if (accountId !== undefined) {
      params.analyticDistribution = [{ accountId, percentage: 100 }]
    }
  } else if (hasOwn(formData, 'analyticDistribution') && Array.isArray(formData.analyticDistribution)) {
    params.analyticDistribution = (formData.analyticDistribution as unknown[]).flatMap((row) => {
      if (row == null || typeof row !== 'object') return []
      const record = row as Record<string, unknown>
      const accountId = optionalBigIntU64(record.accountId ?? record.account_id)
      const percentage = Number(record.percentage ?? 0)
      if (accountId === undefined || !Number.isFinite(percentage)) return []
      return [{ accountId, percentage }]
    })
  }
  if (hasOwn(formData, 'analyticPrecision') && formData.analyticPrecision !== '' && formData.analyticPrecision != null) {
    params.analyticPrecision = Number(formData.analyticPrecision)
  }
  if (hasOwn(formData, 'isActive') && formData.isActive !== '') {
    params.isActive = Boolean(formData.isActive)
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

/** Convert SpacetimeDB timestamp JSON (or number) to `YYYY-MM-DD` for date inputs. */
export function bankStatementTimestampToDateInput(v: unknown): string {
  if (v != null && typeof v === 'object' && 'microsSinceUnixEpoch' in v) {
    const micros = BigInt(String((v as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch))
    const ms = Number(micros / 1000n)
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v / 1000).toISOString().slice(0, 10)
  }
  return ''
}

export function toCreateAccountBankStatementLineParams(
  formData: Record<string, unknown>,
): CreateAccountBankStatementLineParams | null {
  const amount = Number(formData.amount ?? 0)
  if (!Number.isFinite(amount)) return null
  const ac = formData.amountCurrency
  const amountCurrency =
    ac === '' || ac == null || (typeof ac === 'string' && ac.trim() === '')
      ? amount
      : Number(ac)
  if (!Number.isFinite(amountCurrency)) return null

  return {
    date: timestampFromFormDate(formData.date),
    amount,
    amountCurrency,
    currencyId: optionalBigIntU64(formData.currencyId),
    foreignCurrencyId: undefined,
    partnerId: optionalBigIntU64(formData.partnerId),
    bankAccountId: undefined,
    accountNumber: optionalTrimmedString(formData.accountNumber),
    moveId: undefined,
    isReconciled: formData.isReconciled === true,
    transactionType: optionalTrimmedString(formData.transactionType),
    moveIds: [],
    paymentIds: [],
    amountResidual: (() => {
      if (formData.amountResidual === '' || formData.amountResidual == null) return amount
      const r = Number(formData.amountResidual)
      return Number.isFinite(r) ? r : amount
    })(),
    autoReconcileIds: [],
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountBankStatementLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  if (hasOwn(formData, 'date')) raw.date = timestampFromFormDate(formData.date)
  if (hasOwn(formData, 'amount') && formData.amount !== '' && formData.amount != null) {
    raw.amount = Number(formData.amount)
  }
  if (
    hasOwn(formData, 'amountCurrency') &&
    formData.amountCurrency !== '' &&
    formData.amountCurrency != null
  ) {
    raw.amountCurrency = Number(formData.amountCurrency)
  }
  if (hasOwn(formData, 'accountNumber')) {
    raw.accountNumber = nullableTrimmedString(formData.accountNumber)
  }
  if (hasOwn(formData, 'transactionType')) {
    raw.transactionType = nullableTrimmedString(formData.transactionType)
  }
  if (hasOwn(formData, 'metadata')) raw.metadata = nullableTrimmedString(formData.metadata)
  return stdbParamsToJson(raw)
}

export function bankStatementLineParamsToJson(params: object): Record<string, unknown> {
  return stdbParamsToJson(params)
}

function parseBigIntU64Csv(v: unknown): bigint[] {
  const s = String(v ?? '').trim()
  if (s === '') return []
  return s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => BigInt(p.trim()))
}

export function toCreateAccountReconciliationWidgetParams(
  formData: Record<string, unknown>,
): CreateAccountReconciliationWidgetParams | null {
  const accountId = requiredBigIntU64(formData.accountId)
  if (accountId === null) return null
  const moveLineIds = parseBigIntU64Csv(formData.moveLineIds)
  if (moveLineIds.length === 0) return null
  return {
    partnerId: optionalBigIntU64(formData.partnerId),
    accountId,
    moveLineIds,
    toCheck: formData.toCheck === true,
    mode: String(formData.mode ?? 'bank').trim() || 'bank',
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountReconciliationWidgetParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const raw: Record<string, unknown> = {}
  if (hasOwn(formData, 'accountId')) {
    const accountId = requiredBigIntU64(formData.accountId)
    if (accountId === null) return null
    raw.accountId = accountId
  }
  if (hasOwn(formData, 'moveLineIds')) {
    raw.moveLineIds = parseBigIntU64Csv(formData.moveLineIds)
  }
  if (hasOwn(formData, 'toCheck')) raw.toCheck = formData.toCheck === true
  if (hasOwn(formData, 'mode')) {
    const mode = String(formData.mode ?? '').trim()
    if (mode) raw.mode = mode
  }
  if (hasOwn(formData, 'partnerId')) raw.partnerId = nullableBigIntU64(formData.partnerId)
  if (Object.keys(raw).length === 0) return null
  return stdbParamsToJson(raw)
}

export function reconciliationWidgetParamsToJson(params: object): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function bankReconcileParamsToJson(moveIds: bigint[], amountResidual: number): Record<string, unknown> {
  return stdbParamsToJson({ moveIds, amountResidual })
}

export type PaymentResolutionContext = {
  /** When move row has no journal (edge case), use first available sales/purchase journal. */
  defaultJournalId?: bigint
  /** When currency is missing on the move, use journal or company currency. */
  fallbackCurrencyId?: bigint
}

/** Build payment draft for AR/AP from an invoice/bill move row. */
export function toCreatePaymentParamsFromInvoice(
  invoice: Record<string, unknown>,
  companyId: bigint,
  amount: number,
  paymentRef: string,
  memo: string | undefined,
  context?: PaymentResolutionContext,
): CreatePaymentParams | null {
  const journalId =
    optionalBigIntU64(invoice.journalId) ?? context?.defaultJournalId
  const currencyId =
    optionalBigIntU64(invoice.currencyId) ??
    optionalBigIntU64((invoice as { companyCurrencyId?: unknown }).companyCurrencyId) ??
    context?.fallbackCurrencyId
  const partnerId =
    optionalBigIntU64(invoice.partnerId) ??
    optionalBigIntU64((invoice as { commercialPartnerId?: unknown }).commercialPartnerId)
  const cid = optionalBigIntU64(invoice.companyId) ?? companyId
  const mtRaw = invoice.moveType
  const mt =
    mtRaw != null && typeof mtRaw === 'object' && 'tag' in mtRaw
      ? String((mtRaw as { tag: string }).tag)
      : String(mtRaw ?? '')
  if (!journalId || !currencyId || !partnerId) return null
  if (amount <= 0) return null

  const isCustomerInvoice = mt === 'OutInvoice' || mt === 'OutRefund'
  const isVendorBill = mt === 'InInvoice' || mt === 'InRefund'
  if (!isCustomerInvoice && !isVendorBill) return null

  return {
    idempotencyKey: `create-payment:${globalThis.crypto.randomUUID()}`,
    companyId: cid,
    paymentType: isCustomerInvoice ? { tag: 'InBound' as const } : { tag: 'OutBound' as const },
    partnerType: isCustomerInvoice ? { tag: 'Customer' as const } : { tag: 'Supplier' as const },
    partnerId,
    amount,
    currencyId,
    date: undefined,
    journalId,
    ref: paymentRef,
    memo: memo?.trim() ? memo.trim() : undefined,
  }
}

export function paymentParamsToJson(params: CreatePaymentParams): Record<string, unknown> {
  return stdbParamsToJson(params, "CreatePaymentParams")
}

/** Manual payment (Payments tab) — journal, partner, and currency from form. */
export function toCreatePaymentParamsFromManualForm(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreatePaymentParams | null {
  const journalId = optionalBigIntU64(formData.journalId)
  const partnerId = optionalBigIntU64(formData.partnerId)
  const currencyId = optionalBigIntU64(formData.currencyId)
  const amount = Number(formData.amount)
  if (!journalId || !partnerId || !currencyId || !Number.isFinite(amount) || amount <= 0) return null
  const pt = String(formData.paymentType ?? 'InBound').trim()
  const pty = String(formData.partnerType ?? 'Customer').trim()
  return {
    idempotencyKey: `create-payment:${globalThis.crypto.randomUUID()}`,
    companyId,
    paymentType: pt === 'OutBound' ? { tag: 'OutBound' as const } : { tag: 'InBound' as const },
    partnerType: pty === 'Supplier' ? { tag: 'Supplier' as const } : { tag: 'Customer' as const },
    partnerId,
    amount,
    currencyId,
    date: undefined,
    journalId,
    ref: optionalTrimmedString(formData.ref),
    memo: optionalTrimmedString(formData.memo),
  }
}

export function toCreatePaymentTermParamsFromForm(formData: Record<string, unknown>): CreatePaymentTermParams | null {
  const name = optionalTrimmedString(formData.name)
  if (!name) return null
  return { name, note: optionalTrimmedString(formData.note) }
}

function paymentTermValueFromSelect(raw: unknown): { tag: 'Balance' } | { tag: 'Percent' } | { tag: 'Fixed' } {
  const s = String(raw ?? 'Balance').trim()
  if (s === 'Percent') return { tag: 'Percent' as const }
  if (s === 'Fixed') return { tag: 'Fixed' as const }
  return { tag: 'Balance' as const }
}

export function toCreatePaymentTermLineParamsFromForm(
  formData: Record<string, unknown>,
): CreatePaymentTermLineParams | null {
  const paymentTermId = optionalBigIntU64(formData.paymentTermId)
  if (!paymentTermId) return null
  const days = Math.max(0, Math.trunc(Number(formData.days ?? 0)))
  const months = Math.max(0, Math.trunc(Number(formData.months ?? 0)))
  const sequence = Math.max(0, Math.trunc(Number(formData.sequence ?? 0)))
  const valueAmount = Number(formData.valueAmount ?? 0)
  if (!Number.isFinite(valueAmount)) return null
  return {
    paymentTermId,
    value: paymentTermValueFromSelect(formData.value),
    valueAmount,
    days,
    months,
    daysAfterEndOfMonth: Boolean(formData.daysAfterEndOfMonth),
    sequence,
  }
}

export function toCreateCurrencyRateParamsFromForm(formData: Record<string, unknown>): CreateCurrencyRateParams | null {
  const fromCurrency = optionalTrimmedString(formData.fromCurrency)?.toUpperCase()
  const toCurrency = optionalTrimmedString(formData.toCurrency)?.toUpperCase()
  const rate = Number(formData.rate)
  if (!fromCurrency || !toCurrency || !Number.isFinite(rate) || rate <= 0) return null
  return {
    fromCurrency,
    toCurrency,
    rate,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function createCurrencyRateParamsToJson(params: CreateCurrencyRateParams): Record<string, unknown> {
  return stdbParamsToJson(params, "CreateCurrencyRateParams")
}

// ── Fiscal years ─────────────────────────────────────────────────────────────

function fiscalYearTypeFromSelect(raw: unknown): string {
  const s = String(raw ?? 'standard').trim().toLowerCase()
  if (s === 'standard' || s === 'adjustment' || s === 'opening' || s === 'closing') return s
  return 'standard'
}

/** `datetime-local` value from a SpacetimeDB timestamp JSON field. */
export function fiscalYearTimestampToDatetimeLocal(v: unknown): string {
  if (v != null && typeof v === 'object' && 'microsSinceUnixEpoch' in v) {
    const micros = BigInt(String((v as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch))
    const ms = Number(micros / 1000n)
    if (Number.isFinite(ms)) {
      const d = new Date(ms)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
  return ''
}

export function fiscalYearStateTag(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === 'object' && 'tag' in v) return String((v as { tag: string }).tag)
  return String(v ?? '')
}

export function fiscalYearRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    fiscalYearId: String(row.id ?? ''),
    name: String(row.name ?? ''),
    dateFrom: fiscalYearTimestampToDatetimeLocal(row.dateFrom),
    dateTo: fiscalYearTimestampToDatetimeLocal(row.dateTo),
    fiscalYearType: String(row.type ?? 'standard'),
    isAdjustment: Boolean(row.isAdjustment),
    notes: row.notes != null ? String(row.notes) : '',
  }
}

export function toCreateFiscalYearParams(formData: Record<string, unknown>): CreateFiscalYearParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null
  const dateFrom = timestampFromFormDate(formData.dateFrom)
  const dateTo = timestampFromFormDate(formData.dateTo)
  if (dateTo.microsSinceUnixEpoch <= dateFrom.microsSinceUnixEpoch) return null
  return {
    name,
    dateFrom,
    dateTo,
    type: fiscalYearTypeFromSelect(formData.fiscalYearType),
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateFiscalYearParams(formData: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (hasOwn(formData, 'name')) payload.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'dateFrom')) payload.dateFrom = timestampFromFormDate(formData.dateFrom)
  if (hasOwn(formData, 'dateTo')) payload.dateTo = timestampFromFormDate(formData.dateTo)
  if (hasOwn(formData, 'fiscalYearType')) {
    payload.type = fiscalYearTypeFromSelect(formData.fiscalYearType)
  }
  if (hasOwn(formData, 'isAdjustment')) {
    payload.isAdjustment = Boolean(formData.isAdjustment)
  }
  if (hasOwn(formData, 'notes')) payload.notes = nullableTrimmedString(formData.notes)
  if (hasOwn(formData, 'metadata')) payload.metadata = nullableTrimmedString(formData.metadata)
  return stdbParamsToJson(payload)
}

// ── Account periods (fiscal sub-periods) ────────────────────────────────────

export function accountPeriodStateTag(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === 'object' && 'tag' in v) return String((v as { tag: string }).tag)
  return String(v ?? '')
}

export function accountPeriodRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    accountPeriodId: String(row.id ?? ''),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    dateFrom: fiscalYearTimestampToDatetimeLocal(row.dateFrom),
    dateTo: fiscalYearTimestampToDatetimeLocal(row.dateTo),
    isAdjustment: Boolean(row.isAdjustment),
    notes: row.notes != null ? String(row.notes) : '',
  }
}

export function toCreateAccountPeriodParams(
  formData: Record<string, unknown>,
): CreateAccountPeriodParams | null {
  const name = String(formData.name ?? '').trim()
  const code = String(formData.code ?? '').trim()
  const fiscalYearId = requiredBigIntU64(formData.fiscalYearId)
  if (!name || !code || fiscalYearId === null) return null
  const dateFrom = timestampFromFormDate(formData.dateFrom)
  const dateTo = timestampFromFormDate(formData.dateTo)
  if (dateTo.microsSinceUnixEpoch <= dateFrom.microsSinceUnixEpoch) return null
  return {
    name,
    code,
    dateFrom,
    dateTo,
    fiscalYearId,
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountPeriodParams(formData: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (hasOwn(formData, 'name')) payload.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'code')) payload.code = optionalTrimmedString(formData.code)
  if (hasOwn(formData, 'dateFrom')) payload.dateFrom = timestampFromFormDate(formData.dateFrom)
  if (hasOwn(formData, 'dateTo')) payload.dateTo = timestampFromFormDate(formData.dateTo)
  if (hasOwn(formData, 'isAdjustment')) {
    payload.isAdjustment = Boolean(formData.isAdjustment)
  }
  if (hasOwn(formData, 'notes')) payload.notes = nullableTrimmedString(formData.notes)
  if (hasOwn(formData, 'metadata')) payload.metadata = nullableTrimmedString(formData.metadata)
  return stdbParamsToJson(payload)
}

// ── Depreciation lines ─────────────────────────────────────────────────────────

import type { CreateDepreciationLineParams } from '@lumiere/stdb/types'

export function toCreateDepreciationLineParams(
  formData: Record<string, unknown>,
): CreateDepreciationLineParams | null {
  const assetId = requiredBigIntU64(formData.assetId)
  if (assetId === null) return null
  const amount = Number(formData.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    idempotencyKey: `create-depreciation-line:${globalThis.crypto.randomUUID()}`,
    assetId,
    amount,
    depreciationDate: timestampFromFormDate(formData.depreciationDate),
    name: optionalTrimmedString(formData.name),
    moveId: optionalBigIntU64(formData.moveId),
    moveCheck: formData.moveCheck === true,
    movePostedCheck: formData.movePostedCheck === true,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function depreciationLineParamsToJson(params: CreateDepreciationLineParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// ── Intercompany ──────────────────────────────────────────────────────────────

import type {
  CreateIntercompanyRuleParams,
  CreateIntercompanyTransactionParams,
  ProcessIntercompanyTransactionParams,
} from '@lumiere/stdb/types'

/** Maps UI / legacy labels to SpacetimeDB `RuleType` for intercompany reducers. */
function toIntercompanyRuleType(
  raw: unknown,
):
  | { tag: 'Invoice' }
  | { tag: 'Bill' }
  | { tag: 'Payment' }
  | { tag: 'Transfer' }
  | undefined {
  const s = String(raw ?? '').trim()
  switch (s) {
    case 'Invoice':
    case 'Bill':
    case 'Payment':
    case 'Transfer':
      return { tag: s }
    case 'Sale':
      return { tag: 'Invoice' }
    case 'Purchase':
      return { tag: 'Bill' }
    case 'Service':
      return { tag: 'Payment' }
    default:
      return undefined
  }
}

export function toCreateIntercompanyRuleParams(
  formData: Record<string, unknown>,
): CreateIntercompanyRuleParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const ruleType = toIntercompanyRuleType(formData.ruleType)
  if (!ruleType) return null

  return {
    name,
    ruleType,
    autoValidation: formData.autoValidation === true,
    autoGenerateInvoice: formData.autoGenerateInvoice === true,
    autoGenerateBill: formData.autoGenerateBill === true,
    isActive: formData.isActive !== false, // default true
    journalId: optionalBigIntU64(formData.journalId),
    accountId: optionalBigIntU64(formData.accountId),
    pricelistId: optionalBigIntU64(formData.pricelistId),
    sequence: Number(formData.sequence ?? 0),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function intercompanyRuleParamsToJson(params: CreateIntercompanyRuleParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

import type { UpdateIntercompanyRuleParams } from '@lumiere/stdb/types'

/** `Option<Option<T>>` update field: omit → no change; empty → clear; value → set. */
function optionalNestedU64FromForm(
  formData: Record<string, unknown>,
  key: string,
): bigint | null | undefined {
  if (!hasOwn(formData, key)) return undefined
  return nullableBigIntU64(formData[key])
}

function optionalNestedStringFromForm(
  formData: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!hasOwn(formData, key)) return undefined
  return nullableTrimmedString(formData[key])
}

export function toUpdateIntercompanyRuleParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateIntercompanyRuleParams> {
  const params: ClearablePatch<UpdateIntercompanyRuleParams> = {}
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'autoValidation')) params.autoValidation = formData.autoValidation === true
  if (hasOwn(formData, 'autoGenerateInvoice')) {
    params.autoGenerateInvoice = formData.autoGenerateInvoice === true
  }
  if (hasOwn(formData, 'autoGenerateBill')) {
    params.autoGenerateBill = formData.autoGenerateBill === true
  }
  if (hasOwn(formData, 'journalId')) params.journalId = optionalNestedU64FromForm(formData, 'journalId')
  if (hasOwn(formData, 'accountId')) params.accountId = optionalNestedU64FromForm(formData, 'accountId')
  if (hasOwn(formData, 'pricelistId')) {
    params.pricelistId = optionalNestedU64FromForm(formData, 'pricelistId')
  }
  if (hasOwn(formData, 'sequence') && formData.sequence !== '' && formData.sequence != null) {
    params.sequence = Number(formData.sequence)
  }
  if (hasOwn(formData, 'isActive')) params.isActive = formData.isActive === true
  if (hasOwn(formData, 'notes')) params.notes = optionalNestedStringFromForm(formData, 'notes')
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function intercompanyRuleUpdateParamsToJson(
  params: ClearablePatch<UpdateIntercompanyRuleParams>,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toCreateIntercompanyTransactionParams(
  formData: Record<string, unknown>,
): CreateIntercompanyTransactionParams | null {
  const originDocumentId = requiredBigIntU64(formData.originDocumentId)
  if (originDocumentId === null) return null

  const destinationCompanyId = requiredBigIntU64(formData.destinationCompanyId)
  if (destinationCompanyId === null) return null

  const amount = Number(formData.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const currencyId = requiredBigIntU64(formData.currencyId)
  if (currencyId === null) return null

  const transactionType = toIntercompanyRuleType(formData.transactionType)
  if (!transactionType) return null

  const originDocumentModelRaw = String(formData.originDocumentModel ?? '').trim()
  const originDocumentModel =
    originDocumentModelRaw === 'account.move' || originDocumentModelRaw === 'AccountMove'
      ? ({ tag: 'AccountMove' } as const)
      : originDocumentModelRaw === 'sale.order' || originDocumentModelRaw === 'SaleOrder'
        ? ({ tag: 'SaleOrder' } as const)
        : null
  if (!originDocumentModel) return null

  return {
    originDocumentId,
    originDocumentModel,
    destinationCompanyId,
    amount,
    currencyId,
    transactionType,
    autoProcess: formData.autoProcess === true,
    requiresApproval: formData.requiresApproval !== false, // default true
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function intercompanyTransactionParamsToJson(params: CreateIntercompanyTransactionParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toProcessIntercompanyTransactionParams(
  formData: Record<string, unknown>,
): ProcessIntercompanyTransactionParams | null {
  const destinationDocumentId = requiredBigIntU64(formData.destinationDocumentId)
  if (destinationDocumentId === null) return null

  const destinationDocumentModelRaw = String(formData.destinationDocumentModel ?? '').trim()
  const destinationDocumentModel =
    destinationDocumentModelRaw === 'account.move' || destinationDocumentModelRaw === 'AccountMove'
      ? ({ tag: 'AccountMove' } as const)
      : destinationDocumentModelRaw === 'sale.order' || destinationDocumentModelRaw === 'SaleOrder'
        ? ({ tag: 'SaleOrder' } as const)
        : null
  if (!destinationDocumentModel) return null

  return {
    destinationDocumentId,
    destinationDocumentModel,
  }
}

export function processIntercompanyTransactionParamsToJson(
  params: ProcessIntercompanyTransactionParams,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// ── Moves / Payments ────────────────────────────────────────────────────────────

import type { UpdateAccountMoveLineParams } from '@lumiere/stdb/types'

export function toUpdateAccountMoveLineParams(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    companyId: optionalBigIntU64(formData.companyId),
  }
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'debit') && formData.debit !== '' && formData.debit != null) {
    params.debit = Number(formData.debit)
  }
  if (hasOwn(formData, 'credit') && formData.credit !== '' && formData.credit != null) {
    params.credit = Number(formData.credit)
  }
  if (hasOwn(formData, 'partnerId')) params.partnerId = nullableBigIntU64(formData.partnerId)
  if (hasOwn(formData, 'analyticAccountId')) {
    params.analyticAccountId = nullableBigIntU64(formData.analyticAccountId)
  }
  if (hasOwn(formData, 'metadata')) {
    params.metadata = nullableTrimmedString(formData.metadata) ?? undefined
  }
  return params
}

export function updateAccountMoveLineParamsToJson(params: Record<string, unknown>): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// ── Tax (Extended) ────────────────────────────────────────────────────────────

import type {
  CreateAccountTaxGroupParams,
  CreateTaxDeadlineParams,
  CreateTaxJurisdictionParams,
  CreateTaxScheduleParams,
  UpdateAccountTaxGroupParams,
  UpdateTaxDeadlineParams,
  UpdateTaxJurisdictionParams,
  UpdateTaxScheduleParams,
} from '@lumiere/stdb/types'

// Tax Groups
export function toCreateAccountTaxGroupParams(
  formData: Record<string, unknown>,
): CreateAccountTaxGroupParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    sequence: Number(formData.sequence ?? 0),
    precedingSubtotal: optionalTrimmedString(formData.precedingSubtotal),
    taxPayableAccountId: optionalBigIntU64(formData.taxPayableAccountId),
    taxReceivableAccountId: optionalBigIntU64(formData.taxReceivableAccountId),
    advanceTaxPaymentAccountId: optionalBigIntU64(formData.advanceTaxPaymentAccountId),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function createAccountTaxGroupParamsToJson(params: CreateAccountTaxGroupParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toUpdateAccountTaxGroupParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateAccountTaxGroupParams> {
  const params: ClearablePatch<UpdateAccountTaxGroupParams> = {}
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'sequence') && formData.sequence !== '' && formData.sequence != null) {
    params.sequence = Number(formData.sequence)
  }
  if (hasOwn(formData, 'precedingSubtotal')) {
    params.precedingSubtotal = nullableTrimmedString(formData.precedingSubtotal)
  }
  if (hasOwn(formData, 'taxPayableAccountId')) {
    params.taxPayableAccountId = nullableBigIntU64(formData.taxPayableAccountId)
  }
  if (hasOwn(formData, 'taxReceivableAccountId')) {
    params.taxReceivableAccountId = nullableBigIntU64(formData.taxReceivableAccountId)
  }
  if (hasOwn(formData, 'advanceTaxPaymentAccountId')) {
    params.advanceTaxPaymentAccountId = nullableBigIntU64(formData.advanceTaxPaymentAccountId)
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function updateAccountTaxGroupParamsToJson(
  params: ClearablePatch<UpdateAccountTaxGroupParams>,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// Tax Jurisdictions
export function toCreateTaxJurisdictionParams(
  formData: Record<string, unknown>,
): CreateTaxJurisdictionParams | null {
  const name = String(formData.name ?? '').trim()
  const code = String(formData.code ?? '').trim()
  const countryCode = String(formData.countryCode ?? '').trim()
  if (!name || !code || !countryCode) return null

  return {
    name,
    code,
    countryCode,
    stateCode: optionalTrimmedString(formData.stateCode),
    countyCode: optionalTrimmedString(formData.countyCode),
    city: optionalTrimmedString(formData.city),
    zipFrom: optionalTrimmedString(formData.zipFrom),
    zipTo: optionalTrimmedString(formData.zipTo),
    isActive: formData.isActive !== false, // default true
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function createTaxJurisdictionParamsToJson(params: CreateTaxJurisdictionParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toUpdateTaxJurisdictionParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateTaxJurisdictionParams> {
  const params: ClearablePatch<UpdateTaxJurisdictionParams> = {}
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'code')) params.code = optionalTrimmedString(formData.code)
  if (hasOwn(formData, 'stateCode')) params.stateCode = nullableTrimmedString(formData.stateCode)
  if (hasOwn(formData, 'countyCode')) params.countyCode = nullableTrimmedString(formData.countyCode)
  if (hasOwn(formData, 'city')) params.city = nullableTrimmedString(formData.city)
  if (hasOwn(formData, 'zipFrom')) params.zipFrom = nullableTrimmedString(formData.zipFrom)
  if (hasOwn(formData, 'zipTo')) params.zipTo = nullableTrimmedString(formData.zipTo)
  if (hasOwn(formData, 'isActive') && formData.isActive !== '') {
    params.isActive = Boolean(formData.isActive)
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function updateTaxJurisdictionParamsToJson(
  params: ClearablePatch<UpdateTaxJurisdictionParams>,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// Tax Schedules
export function toCreateTaxScheduleParams(
  formData: Record<string, unknown>,
): CreateTaxScheduleParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    description: optionalTrimmedString(formData.description),
    jurisdictionId: optionalBigIntU64(formData.jurisdictionId),
    taxIds: Array.isArray(formData.taxIds)
      ? formData.taxIds.map((id) => BigInt(String(id)))
      : [],
    isActive: formData.isActive !== false, // default true
    effectiveFrom: optionalTimestampFromFormDate(formData.effectiveFrom),
    effectiveTo: optionalTimestampFromFormDate(formData.effectiveTo),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function createTaxScheduleParamsToJson(params: CreateTaxScheduleParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toUpdateTaxScheduleParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateTaxScheduleParams> {
  const params: ClearablePatch<UpdateTaxScheduleParams> = {}
  if (hasOwn(formData, 'name')) params.name = optionalTrimmedString(formData.name)
  if (hasOwn(formData, 'description')) {
    params.description = nullableTrimmedString(formData.description)
  }
  if (hasOwn(formData, 'jurisdictionId')) {
    params.jurisdictionId = nullableBigIntU64(formData.jurisdictionId)
  }
  if (hasOwn(formData, 'taxIds')) {
    params.taxIds = Array.isArray(formData.taxIds)
      ? formData.taxIds.map((id) => BigInt(String(id)))
      : []
  }
  if (hasOwn(formData, 'isActive') && formData.isActive !== '') {
    params.isActive = Boolean(formData.isActive)
  }
  if (hasOwn(formData, 'effectiveFrom')) {
    params.effectiveFrom =
      formData.effectiveFrom == null || String(formData.effectiveFrom).trim() === ''
        ? null
        : optionalTimestampFromFormDate(formData.effectiveFrom) ?? null
  }
  if (hasOwn(formData, 'effectiveTo')) {
    params.effectiveTo =
      formData.effectiveTo == null || String(formData.effectiveTo).trim() === ''
        ? null
        : optionalTimestampFromFormDate(formData.effectiveTo) ?? null
  }
  if (hasOwn(formData, 'metadata')) params.metadata = nullableTrimmedString(formData.metadata)
  return params
}

export function updateTaxScheduleParamsToJson(
  params: ClearablePatch<UpdateTaxScheduleParams>,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// Tax Deadlines
function toTaxDeadlineType(raw: unknown): { tag: 'Filing' | 'Payment' | 'Registration' | 'Report' | 'Renewal' } | undefined {
  const s = String(raw ?? '').trim()
  switch (s) {
    case 'Filing':
    case 'Payment':
    case 'Registration':
    case 'Report':
    case 'Renewal':
      return { tag: s }
    default:
      return undefined
  }
}

export function toCreateTaxDeadlineParams(
  formData: Record<string, unknown>,
): CreateTaxDeadlineParams | null {
  const title = String(formData.title ?? '').trim()
  if (!title) return null

  const deadlineType = toTaxDeadlineType(formData.deadlineType)
  if (!deadlineType) return null

  if (formData.dueDate == null || String(formData.dueDate).trim() === '') return null
  const dueDate = timestampFromFormDate(formData.dueDate)
  if (!dueDate) return null

  return {
    companyId: optionalBigIntU64(formData.companyId),
    taxObligationId: optionalBigIntU64(formData.taxObligationId),
    deadlineType,
    title,
    description: optionalTrimmedString(formData.description),
    dueDate,
    fiscalPeriodStart: optionalTimestampFromFormDate(formData.fiscalPeriodStart),
    fiscalPeriodEnd: optionalTimestampFromFormDate(formData.fiscalPeriodEnd),
    reminderDaysBefore: Array.isArray(formData.reminderDaysBefore)
      ? formData.reminderDaysBefore.map((d) => Number(d))
      : [],
    autoGenerated: formData.autoGenerated === true,
  }
}

export function createTaxDeadlineParamsToJson(params: CreateTaxDeadlineParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function toUpdateTaxDeadlineParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateTaxDeadlineParams> {
  const params: ClearablePatch<UpdateTaxDeadlineParams> = {}
  if (hasOwn(formData, 'title')) params.title = optionalTrimmedString(formData.title)
  if (hasOwn(formData, 'description')) {
    params.description = nullableTrimmedString(formData.description)
  }
  if (hasOwn(formData, 'dueDate') && formData.dueDate != null && String(formData.dueDate).trim() !== '') {
    params.dueDate = optionalTimestampFromFormDate(formData.dueDate)
  }
  if (hasOwn(formData, 'fiscalPeriodStart')) {
    params.fiscalPeriodStart =
      formData.fiscalPeriodStart == null || String(formData.fiscalPeriodStart).trim() === ''
        ? null
        : optionalTimestampFromFormDate(formData.fiscalPeriodStart) ?? null
  }
  if (hasOwn(formData, 'fiscalPeriodEnd')) {
    params.fiscalPeriodEnd =
      formData.fiscalPeriodEnd == null || String(formData.fiscalPeriodEnd).trim() === ''
        ? null
        : optionalTimestampFromFormDate(formData.fiscalPeriodEnd) ?? null
  }
  if (hasOwn(formData, 'reminderDaysBefore')) {
    params.reminderDaysBefore = Array.isArray(formData.reminderDaysBefore)
      ? formData.reminderDaysBefore.map((d) => Number(d))
      : []
  }
  return params
}

export function updateTaxDeadlineParamsToJson(
  params: ClearablePatch<UpdateTaxDeadlineParams>,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

// ── Journals / moves / bank statements / budget lines / credit notes ─────────

type JournalType = CreateAccountJournalParams['type']

function journalTypeTagFromForm(raw: unknown): JournalType {
  const s = String(raw ?? 'Sale').trim()
  if (s === 'Purchase') return { tag: 'Purchase' }
  if (s === 'Bank') return { tag: 'Bank' }
  if (s === 'Cash') return { tag: 'Cash' }
  if (s === 'General') return { tag: 'General' }
  return { tag: 'Sale' }
}

export function toCreateAccountJournalParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateAccountJournalParams {
  return {
    companyId,
    name: String(formData.name ?? '').trim(),
    code: String(formData.code ?? '').trim(),
    type: journalTypeTagFromForm(formData.type),
    currencyId: optionalBigIntU64(formData.currencyId),
    defaultAccountId: optionalBigIntU64(formData.defaultAccountId),
    suspenseAccountId: optionalBigIntU64(formData.suspenseAccountId),
    lossAccountId: optionalBigIntU64(formData.lossAccountId),
    profitAccountId: optionalBigIntU64(formData.profitAccountId),
    bankAccountId: optionalBigIntU64(formData.bankAccountId),
    paymentCreditAccountId: optionalBigIntU64(formData.paymentCreditAccountId),
    paymentDebitAccountId: optionalBigIntU64(formData.paymentDebitAccountId),
    invoiceReferenceType: optionalTrimmedString(formData.invoiceReferenceType),
    invoiceReferenceModel: optionalTrimmedString(formData.invoiceReferenceModel),
    sequenceId: optionalBigIntU64(formData.sequenceId),
    refundSequenceId: optionalBigIntU64(formData.refundSequenceId),
    sequenceOverrideRegex: optionalTrimmedString(formData.sequenceOverrideRegex),
    secureSequenceId: optionalBigIntU64(formData.secureSequenceId),
    aliasName: optionalTrimmedString(formData.aliasName),
    aliasDomain: optionalTrimmedString(formData.aliasDomain),
    saleActivityTypeId: optionalBigIntU64(formData.saleActivityTypeId),
    saleActivityUserId: optionalBigIntU64(formData.saleActivityUserId),
    saleActivityNote: optionalTrimmedString(formData.saleActivityNote),
    saleActivityDateDeadline: optionalTimestampFromFormDate(formData.saleActivityDateDeadline),
    restrictModeHashTable: formData.restrictModeHashTable === true,
    active: formData.active !== false,
    atLeastOneInbound: formData.atLeastOneInbound === true,
    atLeastOneOutbound: formData.atLeastOneOutbound === true,
    dedicatedPaymentMethodIds: u64IdArrayFromForm(formData.dedicatedPaymentMethodIds),
    saleActivityDone: formData.saleActivityDone === true,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

/** Form → journal entry move; alias for coverage and explicit call sites. */
export function toCreateAccountMoveParams(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateAccountMoveParams | null {
  return toCreateJournalEntryMoveParams(formData, companyId)
}

export function toCreateAccountBankStatementParams(
  formData: Record<string, unknown>,
): CreateAccountBankStatementParams | null {
  const currencyId = requiredBigIntU64(formData.currencyId)
  if (currencyId === null) return null
  const balanceStart = Number(field(formData, "balanceStart", "balance_start") ?? 0)
  return {
    name: optionalTrimmedString(formData.name),
    reference: optionalTrimmedString(formData.reference),
    date: optionalTimestampFromFormDate(formData.date),
    balanceStart: Number.isFinite(balanceStart) ? balanceStart : 0,
    currencyId,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateCrossoveredBudgetLineParams(
  formData: Record<string, unknown>,
): CreateCrossoveredBudgetLineParams {
  const plannedAmount = Number(field(formData, "plannedAmount", "planned_amount") ?? 0)
  return {
    analyticAccountId: optionalBigIntU64(field(formData, "analyticAccountId", "analytic_account_id")),
    projectId: optionalBigIntU64(field(formData, "projectId", "project_id")),
    dateFrom: timestampFromFormDate(field(formData, "dateFrom", "date_from")),
    dateTo: timestampFromFormDate(field(formData, "dateTo", "date_to")),
    paidDate: optionalTimestampFromFormDate(field(formData, "paidDate", "paid_date")),
    plannedAmount: Number.isFinite(plannedAmount) ? plannedAmount : 0,
    practicalAmount: Number(field(formData, "practicalAmount", "practical_amount") ?? 0),
    theoreticalAmount: Number(field(formData, "theoreticalAmount", "theoretical_amount") ?? 0),
    achievePercentage: Number(field(formData, "achievePercentage", "achieve_percentage") ?? 0),
    isAboveBudget: formData.isAboveBudget === true || formData.is_above_budget === true,
    variance: Number(formData.variance ?? -plannedAmount),
    variancePercentage: Number(
      field(formData, "variancePercentage", "variance_percentage") ??
        (plannedAmount > 0 ? -100 : 0),
    ),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateCreditNoteParams(
  formData: Record<string, unknown>,
): CreateCreditNoteParams {
  const lineIdsRaw = field(formData, "lineIds", "line_ids")
  const lineIds = Array.isArray(lineIdsRaw)
    ? lineIdsRaw.map((id) => BigInt(String(id)))
    : u64IdArrayFromForm(lineIdsRaw)
  const reasonRaw = formData.reason
  const reason =
    reasonRaw == null || String(reasonRaw).trim() === ''
      ? undefined
      : String(reasonRaw).trim()
  return {
    lineIds,
    reason,
  }
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function requiredTrimmedString(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function assetTypeFromForm(raw: unknown): AssetType {
  const tag = capitalizeTag(String(raw ?? 'Purchase'))
  if (tag === 'Sale') return { tag: 'Sale' }
  return { tag: 'Purchase' }
}

function depreciationMethodFromForm(raw: unknown): DepreciationMethod {
  const tag = String(raw ?? 'Linear')
  switch (tag) {
    case 'Degressive':
    case 'DegressiveThenLinear':
      return { tag }
    default:
      return { tag: 'Linear' }
  }
}

export type AccountAssetMapperContext = {
  currencyId: bigint
  accountAssetId: bigint
  accountDepreciationId: bigint
  accountDepreciationExpenseId: bigint
  journalId: bigint
}

/** Maps fixed-asset form data; GL account IDs come from context. */
export function toCreateAccountAssetParams(
  formData: Record<string, unknown>,
  context: AccountAssetMapperContext,
): CreateAccountAssetParams | null {
  const code = requiredTrimmedString(field(formData, 'code', 'code'))
  const name = requiredTrimmedString(field(formData, 'name', 'name'))
  if (!code || !name) return null

  return {
    idempotencyKey: `create-account-asset:${globalThis.crypto.randomUUID()}`,
    code,
    name,
    active: field(formData, 'active', 'active') !== false,
    assetType: assetTypeFromForm(field(formData, 'assetType', 'asset_type')),
    currencyId: optionalBigIntU64(field(formData, 'currencyId', 'currency_id')) ?? context.currencyId,
    originalValue: num(field(formData, 'originalValue', 'original_value'), 0),
    salvageValue: num(field(formData, 'salvageValue', 'salvage_value'), 0),
    method: depreciationMethodFromForm(field(formData, 'method', 'method')),
    methodNumber: Math.trunc(num(field(formData, 'methodNumber', 'method_number'), 5)),
    methodPeriod: Math.trunc(num(field(formData, 'methodPeriod', 'method_period'), 12)),
    methodProgressFactor: num(field(formData, 'methodProgressFactor', 'method_progress_factor'), 0),
    prorata: field(formData, 'prorata', 'prorata') === true,
    prorataDate: optionalTimestampFromFormDate(field(formData, 'prorataDate', 'prorata_date')),
    accountAssetId:
      optionalBigIntU64(field(formData, 'accountAssetId', 'account_asset_id')) ?? context.accountAssetId,
    accountDepreciationId:
      optionalBigIntU64(field(formData, 'accountDepreciationId', 'account_depreciation_id')) ??
      context.accountDepreciationId,
    accountDepreciationExpenseId:
      optionalBigIntU64(
        field(formData, 'accountDepreciationExpenseId', 'account_depreciation_expense_id'),
      ) ?? context.accountDepreciationExpenseId,
    journalId: optionalBigIntU64(field(formData, 'journalId', 'journal_id')) ?? context.journalId,
    acquisitionDate: timestampFromFormDate(
      field(formData, 'acquisitionDate', 'acquisition_date'),
    ),
    accountAnalyticId: optionalBigIntU64(field(formData, 'accountAnalyticId', 'account_analytic_id')),
    parentId: optionalBigIntU64(field(formData, 'parentId', 'parent_id')),
    gainAccountId: optionalBigIntU64(field(formData, 'gainAccountId', 'gain_account_id')),
    lossAccountId: optionalBigIntU64(field(formData, 'lossAccountId', 'loss_account_id')),
    accountDisposalId: optionalBigIntU64(field(formData, 'accountDisposalId', 'account_disposal_id')),
    firstDepreciationDate: optionalTimestampFromFormDate(
      field(formData, 'firstDepreciationDate', 'first_depreciation_date'),
    ),
    firstDepreciationDateManual: optionalTimestampFromFormDate(
      field(formData, 'firstDepreciationDateManual', 'first_depreciation_date_manual'),
    ),
    alreadyDepreciatedAmountImport: num(
      field(formData, 'alreadyDepreciatedAmountImport', 'already_depreciated_amount_import'),
      0,
    ),
    isImported: field(formData, 'isImported', 'is_imported') === true,
    accountAnalyticTagIds: u64IdArrayFromForm(
      field(formData, 'accountAnalyticTagIds', 'account_analytic_tag_ids'),
    ),
    assetLifetimeDays: Math.trunc(num(field(formData, 'assetLifetimeDays', 'asset_lifetime_days'), 0)),
    assetPausedDays: Math.trunc(num(field(formData, 'assetPausedDays', 'asset_paused_days'), 0)),
    depreciationSchedule: optionalTrimmedString(
      field(formData, 'depreciationSchedule', 'depreciation_schedule'),
    ),
    metadata: optionalTrimmedString(field(formData, 'metadata', 'metadata')),
  }
}

export type ConsolidationAccountMapperContext = {
  companyIds: bigint[]
  eliminationAccountId?: bigint
}

export function toCreateConsolidationAccountParams(
  formData: Record<string, unknown>,
  context?: ConsolidationAccountMapperContext,
): CreateConsolidationAccountParams | null {
  const name = requiredTrimmedString(field(formData, 'name', 'name'))
  const code = requiredTrimmedString(field(formData, 'code', 'code'))
  const accountType = requiredTrimmedString(field(formData, 'accountType', 'account_type'))
  const currencyId = requiredBigIntU64(field(formData, 'currencyId', 'currency_id'))
  if (!name || !code || !accountType || currencyId === null) return null

  const companyIds =
    u64IdArrayFromForm(field(formData, 'companyIds', 'company_ids')).length > 0
      ? u64IdArrayFromForm(field(formData, 'companyIds', 'company_ids'))
      : (context?.companyIds ?? [])

  const eliminationMethodRaw = optionalTrimmedString(
    field(formData, 'eliminationMethod', 'elimination_method'),
  )

  return {
    name,
    code,
    accountType,
    companyIds,
    consolidationRate: num(field(formData, 'consolidationRate', 'consolidation_rate'), 100),
    currencyId,
    eliminationAccountId:
      optionalBigIntU64(field(formData, 'eliminationAccountId', 'elimination_account_id')) ??
      context?.eliminationAccountId,
    isIntercompany: field(formData, 'isIntercompany', 'is_intercompany') === true,
    eliminationMethod: eliminationMethodRaw,
    notes: optionalTrimmedString(field(formData, 'notes', 'notes')),
    isActive: field(formData, 'isActive', 'is_active') !== false,
    metadata: optionalTrimmedString(field(formData, 'metadata', 'metadata')),
  }
}

export type ConsolidationJournalMapperContext = {
  periodId: bigint
  companyIds: bigint[]
}

export function toCreateConsolidationJournalParams(
  formData: Record<string, unknown>,
  context?: ConsolidationJournalMapperContext,
): CreateConsolidationJournalParams | null {
  const name = requiredTrimmedString(field(formData, 'name', 'name'))
  const currencyId = requiredBigIntU64(field(formData, 'currencyId', 'currency_id'))
  const periodId =
    optionalBigIntU64(field(formData, 'periodId', 'period_id')) ?? context?.periodId
  if (!name || currencyId === null || periodId === undefined) return null

  const companyIds =
    u64IdArrayFromForm(field(formData, 'companyIds', 'company_ids')).length > 0
      ? u64IdArrayFromForm(field(formData, 'companyIds', 'company_ids'))
      : (context?.companyIds ?? [])

  return {
    name,
    periodId,
    dateFrom: timestampFromFormDate(field(formData, 'dateFrom', 'date_from')),
    dateTo: timestampFromFormDate(field(formData, 'dateTo', 'date_to')),
    companyIds,
    currencyId,
    exchangeRate: num(field(formData, 'exchangeRate', 'exchange_rate'), 1),
    exchangeRateDate: optionalTimestampFromFormDate(
      field(formData, 'exchangeRateDate', 'exchange_rate_date'),
    ),
    notes: optionalTrimmedString(field(formData, 'notes', 'notes')),
    metadata: optionalTrimmedString(field(formData, 'metadata', 'metadata')),
  }
}

export function toCreateEliminationEntryParams(
  formData: Record<string, unknown>,
): CreateEliminationEntryParams | null {
  const journalId = requiredBigIntU64(field(formData, 'journalId', 'journal_id'))
  const name = requiredTrimmedString(field(formData, 'name', 'name'))
  const accountId = requiredBigIntU64(field(formData, 'accountId', 'account_id'))
  const companyId = requiredBigIntU64(field(formData, 'companyId', 'company_id'))
  const currencyId = requiredBigIntU64(field(formData, 'currencyId', 'currency_id'))
  const eliminationType = requiredTrimmedString(
    field(formData, 'eliminationType', 'elimination_type'),
  )
  if (
    journalId === null ||
    !name ||
    accountId === null ||
    companyId === null ||
    currencyId === null ||
    !eliminationType
  ) {
    return null
  }

  const debit = num(field(formData, 'debit', 'debit'), 0)
  const credit = num(field(formData, 'credit', 'credit'), 0)
  const amountCurrency = num(
    field(formData, 'amountCurrency', 'amount_currency'),
    Math.max(debit, credit),
  )

  return {
    journalId,
    name,
    accountId,
    companyId,
    counterpartyCompanyId: optionalBigIntU64(
      field(formData, 'counterpartyCompanyId', 'counterparty_company_id'),
    ),
    debit,
    credit,
    currencyId,
    amountCurrency,
    eliminationType,
    reference: optionalTrimmedString(field(formData, 'reference', 'reference')),
    notes: optionalTrimmedString(field(formData, 'notes', 'notes')),
    metadata: optionalTrimmedString(field(formData, 'metadata', 'metadata')),
  }
}

export function toRunFxRevaluationParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const currencyId = requiredBigIntU64(formData.currencyId)
  const journalId = requiredBigIntU64(formData.journalId)
  const accountId = requiredBigIntU64(formData.accountId)
  const gainAccountId = requiredBigIntU64(formData.gainAccountId)
  const lossAccountId = requiredBigIntU64(formData.lossAccountId)
  const adjustment = Number(formData.adjustment)
  const rate = Number(formData.rate)
  const rateSource = optionalTrimmedString(formData.rateSource)
  if (
    currencyId == null ||
    journalId == null ||
    accountId == null ||
    gainAccountId == null ||
    lossAccountId == null ||
    !Number.isFinite(adjustment) ||
    adjustment === 0 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !rateSource
  ) {
    return null
  }
  return {
    currencyId,
    asOfDate: timestampFromFormDate(formData.asOfDate),
    rate,
    rateSource,
    rateEffectiveDate: timestampFromFormDate(formData.rateEffectiveDate),
    journalId,
    gainAccountId,
    lossAccountId,
    lines: [{ accountId, adjustment }],
    reference: optionalTrimmedString(formData.reference),
  }
}

export function runFxRevaluationParamsToJson(params: Record<string, unknown>): Record<string, unknown> {
  return stdbParamsToJson(params, 'RunFxRevaluationParams')
}

export function toRunFxRevaluationBatchParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const currencyId = requiredBigIntU64(formData.currencyId)
  const journalId = requiredBigIntU64(formData.journalId)
  const gainAccountId = requiredBigIntU64(formData.gainAccountId)
  const lossAccountId = requiredBigIntU64(formData.lossAccountId)
  const rate = Number(formData.rate)
  const rateSource = optionalTrimmedString(formData.rateSource)
  if (
    currencyId == null ||
    journalId == null ||
    gainAccountId == null ||
    lossAccountId == null ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !rateSource
  ) {
    return null
  }
  return {
    currencyId,
    asOfDate: timestampFromFormDate(formData.asOfDate),
    journalId,
    gainAccountId,
    lossAccountId,
    rate,
    rateSource,
    rateEffectiveDate: timestampFromFormDate(formData.rateEffectiveDate),
    reference: optionalTrimmedString(formData.reference),
  }
}

export function toPostRealizedFxParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const paymentId = requiredBigIntU64(formData.paymentId)
  const invoiceMoveId = requiredBigIntU64(formData.invoiceMoveId)
  const journalId = requiredBigIntU64(formData.journalId)
  const gainAccountId = requiredBigIntU64(formData.gainAccountId)
  const lossAccountId = requiredBigIntU64(formData.lossAccountId)
  const clearingAccountId = requiredBigIntU64(formData.clearingAccountId)
  const paymentAmountFunctional = Number(formData.paymentAmountFunctional)
  const invoiceResidualFunctional = Number(formData.invoiceResidualFunctional)
  if (
    paymentId == null ||
    invoiceMoveId == null ||
    journalId == null ||
    gainAccountId == null ||
    lossAccountId == null ||
    clearingAccountId == null ||
    !Number.isFinite(paymentAmountFunctional) ||
    !Number.isFinite(invoiceResidualFunctional)
  ) {
    return null
  }
  return {
    paymentId,
    invoiceMoveId,
    paymentAmountFunctional,
    invoiceResidualFunctional,
    journalId,
    gainAccountId,
    lossAccountId,
    clearingAccountId,
    date: timestampFromFormDate(formData.date),
    reference: optionalTrimmedString(formData.reference),
  }
}

export function toUpsertPartnerCreditControlParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const partnerId = requiredBigIntU64(formData.partnerId)
  const creditLimit = Number(formData.creditLimit)
  if (partnerId == null || !Number.isFinite(creditLimit) || creditLimit < 0) {
    return null
  }
  return {
    partnerId,
    creditLimit,
    paymentHold: Boolean(formData.paymentHold),
    notes: optionalTrimmedString(formData.notes),
  }
}

export function toCreateBadDebtWriteOffParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const partnerId = requiredBigIntU64(formData.partnerId)
  const moveId = requiredBigIntU64(formData.moveId)
  const journalId = requiredBigIntU64(formData.journalId)
  const receivableAccountId = requiredBigIntU64(formData.receivableAccountId)
  const writeOffAccountId = requiredBigIntU64(formData.writeOffAccountId)
  const amount = Number(formData.amount)
  if (
    partnerId == null ||
    moveId == null ||
    journalId == null ||
    receivableAccountId == null ||
    writeOffAccountId == null ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null
  }
  return {
    partnerId,
    moveId,
    amount,
    journalId,
    receivableAccountId,
    writeOffAccountId,
    date: timestampFromFormDate(formData.date),
    reference: optionalTrimmedString(formData.reference),
  }
}

export function toCreateAmortizationScheduleParamsFromForm(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const scheduleKind = optionalTrimmedString(formData.scheduleKind)
  const description = optionalTrimmedString(formData.description)
  const journalId = requiredBigIntU64(formData.journalId)
  const balanceSheetAccountId = requiredBigIntU64(formData.balanceSheetAccountId)
  const plAccountId = requiredBigIntU64(formData.plAccountId)
  const currencyId = requiredBigIntU64(formData.currencyId)
  const recognitionPeriod = optionalTrimmedString(formData.recognitionPeriod)
  const totalAmount = Number(formData.totalAmount)
  if (
    !scheduleKind ||
    !description ||
    journalId == null ||
    balanceSheetAccountId == null ||
    plAccountId == null ||
    currencyId == null ||
    !recognitionPeriod ||
    !Number.isFinite(totalAmount) ||
    totalAmount <= 0
  ) {
    return null
  }
  return {
    scheduleKind,
    description,
    journalId,
    balanceSheetAccountId,
    plAccountId,
    currencyId,
    totalAmount,
    startDate: timestampFromFormDate(formData.startDate),
    endDate: timestampFromFormDate(formData.endDate),
    recognitionPeriod,
  }
}
