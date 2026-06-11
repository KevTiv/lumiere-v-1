/**
 * Maps Accounting module form payloads to SpacetimeDB reducer param types.
 */

import type {
  CreateAccountAccountParams,
  CreateAccountAccountTypeParams,
  CreateAccountBankStatementLineParams,
  CreateAccountGroupParams,
  CreateAccountMoveParams,
  CreateAccountPeriodParams,
  CreateAccountReconciliationWidgetParams,
  CreateAccountTaxParams,
  CreateAnalyticAccountParams,
  CreateAnalyticDistributionModelParams,
  CreateAnalyticLineParams,
  CreateBudgetPostParams,
  CreateCrossoveredBudgetParams,
  CreateCurrencyRateParams,
  CreateFiscalYearParams,
  CreatePaymentParams,
  CreatePaymentTermLineParams,
  CreatePaymentTermParams,
  UpdateAccountAccountTypeParams,
  UpdateAccountGroupParams,
  UpdateAnalyticAccountParams,
  UpdateAnalyticDistributionModelParams,
  UpdateAnalyticLineParams,
  UpdateBudgetPostParams,
} from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { userTypeIdFromAccountTypes, userTypeIdFromInternalGroup } from "./accounting-defaults"
import {
  optionalBigIntU64,
  parseDelimitedU64Ids,
  u64IdArrayFromForm,
} from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"
import { stdbParamsToJson } from "./stdb-params-json"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function timestampFromFormDate(v: unknown, fallback = new Date()): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  return stbTimestampFromDate(fallback)
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
  opts?: { accountTypes?: ReadonlyArray<Record<string, unknown>> },
): CreateAccountAccountParams | null {
  const rawUt = formData.userTypeId
  let userTypeId: bigint | null =
    rawUt != null && rawUt !== "" ? requiredBigIntU64(rawUt) : null

  if (userTypeId == null && opts?.accountTypes?.length) {
    userTypeId =
      userTypeIdFromAccountTypes(opts.accountTypes, String(formData.internalGroup ?? "")) ?? null
  }

  if (userTypeId == null) {
    userTypeId = userTypeIdFromInternalGroup(String(formData.internalGroup ?? "")) ?? null
  }

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

/** SATS sum type with unit variants: `{"Sale":[]}` etc. (matches SpacetimeDB HTTP / Rust serde for these enums). */
function stdbTaggedUnitEnumToSumJson(v: { tag: string }): Record<string, unknown> {
  return { [v.tag]: [] }
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
    description: params.description ?? null,
    type_tax_use: stdbTaggedUnitEnumToSumJson(typeTaxUse),
    amount_type: stdbTaggedUnitEnumToSumJson(amountType),
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

/** SATS unit-variant sum JSON for SpacetimeDB HTTP (keys are lowercase, e.g. `{"sale":[]}`). */
function stdbTaggedUnitEnumToHttpSumJson(v: { tag: string }): Record<string, unknown> {
  const t = v.tag
  const key = t.charAt(0).toLowerCase() + t.slice(1)
  return { [key]: [] }
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
): UpdateAccountGroupParams['parentId'] {
  if (!('parentId' in formData)) return undefined
  const raw = formData.parentId
  if (raw === '' || raw == null) {
    return null as unknown as UpdateAccountGroupParams['parentId']
  }
  return optionalBigIntU64(raw)
}

export function toCreateBudgetPostParams(formData: Record<string, unknown>): CreateBudgetPostParams {
  return {
    companyId: undefined,
    name: String(formData.name ?? '').trim(),
    code: optionalTrimmedString(formData.code),
    description: optionalTrimmedString(formData.description),
    accountIds: parseAccountIdList(formData.accountIds),
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateBudgetPostParams(formData: Record<string, unknown>): UpdateBudgetPostParams {
  return {
    companyId: undefined,
    name: String(formData.name ?? '').trim(),
    code: optionalTrimmedString(formData.code),
    description: optionalTrimmedString(formData.description),
    accountIds: parseAccountIdList(formData.accountIds),
    isActive: Boolean(formData.isActive),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toCreateAccountAccountTypeParams(
  formData: Record<string, unknown>,
): CreateAccountAccountTypeParams {
  return {
    name: String(formData.name ?? '').trim(),
    type: String(formData.type ?? '').trim(),
    internalGroup: toInternalGroup(formData.internalGroup) ?? { tag: 'Asset' },
    includeInitialBalance: Boolean(formData.includeInitialBalance),
    companyId: undefined,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountAccountTypeParams(
  formData: Record<string, unknown>,
): UpdateAccountAccountTypeParams {
  return {
    companyId: undefined,
    name: optionalTrimmedString(formData.name),
    type: optionalTrimmedString(formData.type),
    internalGroup:
      formData.internalGroup === '' || formData.internalGroup == null
        ? undefined
        : toInternalGroup(formData.internalGroup),
    includeInitialBalance:
      formData.includeInitialBalance === '' || formData.includeInitialBalance === undefined
        ? undefined
        : Boolean(formData.includeInitialBalance),
    isDeprecated:
      formData.isDeprecated === '' || formData.isDeprecated === undefined
        ? undefined
        : Boolean(formData.isDeprecated),
    metadata: optionalTrimmedString(formData.metadata),
  }
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
  companyId?: bigint,
): UpdateAccountGroupParams {
  return {
    companyId,
    name: optionalTrimmedString(formData.name),
    codePrefixStart: optionalTrimmedString(formData.codePrefixStart),
    codePrefixEnd: optionalTrimmedString(formData.codePrefixEnd),
    level:
      formData.level === '' || formData.level == null
        ? undefined
        : Math.max(0, Math.trunc(Number(formData.level))),
    parentId: updateAccountGroupParentId(formData),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function accountingParamsToJson(
  params:
    | CreateAccountAccountParams
    | CreateAccountMoveParams
    | CreateCrossoveredBudgetParams
    | CreateFiscalYearParams
    | CreateAccountPeriodParams,
): Record<string, unknown> {
  return stdbParamsToJson(params)
}

export function analyticParamsToJson(params: object): Record<string, unknown> {
  return stdbParamsToJson(params)
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
    lineIds: [],
    childIds: [],
    messageFollowerIds: [],
    activityIds: [],
    messageIds: [],
    balance: Number(formData.balance ?? 0),
    debit: Number(formData.debit ?? 0),
    credit: Number(formData.credit ?? 0),
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
    date: timestampFromFormDate(formData.date ?? new Date().toISOString()),
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
  const distribution = JSON.stringify([
    { account_id: Number(accountId), percentage: 100 },
  ])
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
    analyticDistribution: distribution,
    analyticPrecision,
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAnalyticAccountParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): UpdateAnalyticAccountParams {
  return {
    companyId,
    name: optionalTrimmedString(formData.name),
    code:
      formData.code === '' || formData.code == null
        ? undefined
        : optionalTrimmedString(formData.code),
    partnerId: optionalBigIntU64(formData.partnerId),
    planId: optionalBigIntU64(formData.planId),
    groupId: optionalBigIntU64(formData.groupId),
    color:
      formData.color != null && String(formData.color).trim() !== ''
        ? Number(formData.color)
        : undefined,
    isRequiredInMoveLines:
      formData.isRequiredInMoveLines === ''
        ? undefined
        : formData.isRequiredInMoveLines === undefined
          ? undefined
          : Boolean(formData.isRequiredInMoveLines),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAnalyticLineParams(
  formData: Record<string, unknown>,
): UpdateAnalyticLineParams {
  return {
    name: optionalTrimmedString(formData.name),
    amount:
      formData.amount === '' || formData.amount == null
        ? undefined
        : Number(formData.amount),
    unitAmount:
      formData.unitAmount === '' || formData.unitAmount == null
        ? undefined
        : Number(formData.unitAmount),
    partnerId: optionalBigIntU64(formData.partnerId),
    projectId: optionalBigIntU64(formData.projectId),
    taskId: optionalBigIntU64(formData.taskId),
    category: optionalTrimmedString(formData.category),
    tagIds: optionalTagIdsForAnalyticLineUpdate(formData),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAnalyticDistributionModelParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): UpdateAnalyticDistributionModelParams {
  const dist = optionalTrimmedString(formData.analyticDistribution)
  return {
    companyId,
    name: optionalTrimmedString(formData.name),
    partnerCategoryId: optionalBigIntU64(formData.partnerCategoryId),
    productId: optionalBigIntU64(formData.productId),
    productCategId: optionalBigIntU64(formData.productCategId),
    analyticDistribution: dist,
    analyticPrecision:
      formData.analyticPrecision === '' || formData.analyticPrecision == null
        ? undefined
        : Number(formData.analyticPrecision),
    isActive:
      formData.isActive === '' ? undefined : formData.isActive === undefined
        ? undefined
        : Boolean(formData.isActive),
    metadata: optionalTrimmedString(formData.metadata),
  }
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
  return new Date().toISOString().slice(0, 10)
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
    date: timestampFromFormDate(formData.date ?? new Date()),
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
  const amount = Number(formData.amount ?? 0)
  const ac = formData.amountCurrency
  const amountCurrency =
    ac === '' || ac == null || (typeof ac === 'string' && ac.trim() === '')
      ? amount
      : Number(ac)
  const raw: Record<string, unknown> = {
    date: timestampFromFormDate(formData.date ?? new Date()),
    amount: Number.isFinite(amount) ? amount : 0,
    amountCurrency: Number.isFinite(amountCurrency) ? amountCurrency : amount,
  }
  const acct = optionalTrimmedString(formData.accountNumber)
  if (acct !== undefined) raw.accountNumber = acct
  const tt = optionalTrimmedString(formData.transactionType)
  if (tt !== undefined) raw.transactionType = tt
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
  const accountId = requiredBigIntU64(formData.accountId)
  if (accountId === null) return null
  const moveLineIds = parseBigIntU64Csv(formData.moveLineIds)
  const raw: Record<string, unknown> = {
    accountId,
    moveLineIds,
    toCheck: formData.toCheck === true,
    mode: String(formData.mode ?? 'bank').trim() || 'bank',
  }
  const pid = optionalBigIntU64(formData.partnerId)
  if (pid !== undefined) raw.partnerId = pid
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
  return stdbParamsToJson(params)
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
  return stdbParamsToJson(params)
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
    state: { tag: 'Draft' as const },
    carryOverAccounts: [],
    closingMoveId: undefined,
    openingMoveId: undefined,
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateFiscalYearParams(formData: Record<string, unknown>): Record<string, unknown> {
  const payload = {
    name: String(formData.name ?? '').trim(),
    dateFrom: timestampFromFormDate(formData.dateFrom),
    dateTo: timestampFromFormDate(formData.dateTo),
    type: fiscalYearTypeFromSelect(formData.fiscalYearType),
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
  }
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
    state: { tag: 'Draft' as const },
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function toUpdateAccountPeriodParams(formData: Record<string, unknown>): Record<string, unknown> {
  const payload = {
    name: String(formData.name ?? '').trim(),
    code: String(formData.code ?? '').trim(),
    dateFrom: timestampFromFormDate(formData.dateFrom),
    dateTo: timestampFromFormDate(formData.dateTo),
    isAdjustment: Boolean(formData.isAdjustment),
    notes: optionalTrimmedString(formData.notes),
  }
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
    assetId,
    amount,
    depreciationDate: timestampFromFormDate(formData.depreciationDate ?? new Date()),
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

  return {
    originDocumentId,
    originDocumentModel: String(formData.originDocumentModel ?? 'sale.order').trim(),
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

  return {
    destinationDocumentId,
    destinationDocumentModel: String(formData.destinationDocumentModel ?? 'sale.order').trim(),
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
): UpdateAccountMoveLineParams {
  return {
    companyId: optionalBigIntU64(formData.companyId),
    name: optionalTrimmedString(formData.name),
    debit: formData.debit === '' || formData.debit == null ? undefined : Number(formData.debit),
    credit: formData.credit === '' || formData.credit == null ? undefined : Number(formData.credit),
    partnerId: formData.partnerId === '' || formData.partnerId == null
      ? undefined
      : optionalBigIntU64(formData.partnerId),
    analyticAccountId: formData.analyticAccountId === '' || formData.analyticAccountId == null
      ? undefined
      : optionalBigIntU64(formData.analyticAccountId),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function updateAccountMoveLineParamsToJson(params: UpdateAccountMoveLineParams): Record<string, unknown> {
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
): UpdateAccountTaxGroupParams {
  return {
    name: optionalTrimmedString(formData.name),
    sequence: formData.sequence === '' || formData.sequence == null ? undefined : Number(formData.sequence),
    precedingSubtotal: formData.precedingSubtotal === '' || formData.precedingSubtotal == null
      ? undefined
      : optionalTrimmedString(formData.precedingSubtotal),
    taxPayableAccountId: formData.taxPayableAccountId === '' || formData.taxPayableAccountId == null
      ? undefined
      : optionalBigIntU64(formData.taxPayableAccountId),
    taxReceivableAccountId: formData.taxReceivableAccountId === '' || formData.taxReceivableAccountId == null
      ? undefined
      : optionalBigIntU64(formData.taxReceivableAccountId),
    advanceTaxPaymentAccountId: formData.advanceTaxPaymentAccountId === '' || formData.advanceTaxPaymentAccountId == null
      ? undefined
      : optionalBigIntU64(formData.advanceTaxPaymentAccountId),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function updateAccountTaxGroupParamsToJson(params: UpdateAccountTaxGroupParams): Record<string, unknown> {
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
): UpdateTaxJurisdictionParams {
  return {
    name: optionalTrimmedString(formData.name),
    code: optionalTrimmedString(formData.code),
    stateCode: formData.stateCode === '' || formData.stateCode == null
      ? undefined
      : optionalTrimmedString(formData.stateCode),
    countyCode: formData.countyCode === '' || formData.countyCode == null
      ? undefined
      : optionalTrimmedString(formData.countyCode),
    city: formData.city === '' || formData.city == null
      ? undefined
      : optionalTrimmedString(formData.city),
    zipFrom: formData.zipFrom === '' || formData.zipFrom == null
      ? undefined
      : optionalTrimmedString(formData.zipFrom),
    zipTo: formData.zipTo === '' || formData.zipTo == null
      ? undefined
      : optionalTrimmedString(formData.zipTo),
    isActive: formData.isActive === '' || formData.isActive == null ? undefined : Boolean(formData.isActive),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function updateTaxJurisdictionParamsToJson(params: UpdateTaxJurisdictionParams): Record<string, unknown> {
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
): UpdateTaxScheduleParams {
  return {
    name: optionalTrimmedString(formData.name),
    description: formData.description === '' || formData.description == null
      ? undefined
      : optionalTrimmedString(formData.description),
    jurisdictionId: formData.jurisdictionId === '' || formData.jurisdictionId == null
      ? undefined
      : optionalBigIntU64(formData.jurisdictionId),
    taxIds: formData.taxIds === undefined
      ? undefined
      : Array.isArray(formData.taxIds)
        ? formData.taxIds.map((id) => BigInt(String(id)))
        : [],
    isActive: formData.isActive === '' || formData.isActive == null ? undefined : Boolean(formData.isActive),
    effectiveFrom: formData.effectiveFrom === undefined
      ? undefined
      : optionalTimestampFromFormDate(formData.effectiveFrom),
    effectiveTo: formData.effectiveTo === undefined
      ? undefined
      : optionalTimestampFromFormDate(formData.effectiveTo),
    metadata: optionalTrimmedString(formData.metadata),
  }
}

export function updateTaxScheduleParamsToJson(params: UpdateTaxScheduleParams): Record<string, unknown> {
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
  if (!deadlineType) return undefined as unknown as null

  const dueDate = formData.dueDate != null && String(formData.dueDate).trim() !== ''
    ? timestampFromFormDate(formData.dueDate)
    : undefined as unknown as null
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
): UpdateTaxDeadlineParams {
  return {
    title: optionalTrimmedString(formData.title),
    description: optionalTrimmedString(formData.description),
    dueDate: formData.dueDate === undefined
      ? undefined
      : optionalTimestampFromFormDate(formData.dueDate),
    fiscalPeriodStart: formData.fiscalPeriodStart === undefined
      ? undefined
      : optionalTimestampFromFormDate(formData.fiscalPeriodStart),
    fiscalPeriodEnd: formData.fiscalPeriodEnd === undefined
      ? undefined
      : optionalTimestampFromFormDate(formData.fiscalPeriodEnd),
    reminderDaysBefore: formData.reminderDaysBefore === undefined
      ? undefined
      : Array.isArray(formData.reminderDaysBefore)
        ? formData.reminderDaysBefore.map((d) => Number(d))
        : [],
  }
}

export function updateTaxDeadlineParamsToJson(params: UpdateTaxDeadlineParams): Record<string, unknown> {
  return stdbParamsToJson(params)
}
