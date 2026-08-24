/**
 * Maps Subscriptions / revenue recognition form payloads to SpacetimeDB reducer bodies.
 */

import type {
  AmendSubscriptionParams,
  ApplySubscriptionInvoicePaymentParams,
  CancelSubscriptionParams,
  CloseSubscriptionParams,
  CreateDeferredRevenueScheduleParams,
  CreateRevenueRecognitionRuleParams,
  CreateSubscriptionPriceTierParams,
  GenerateSubscriptionInvoiceParams,
  IngestSubscriptionUsageEventParams,
  RecognizeDeferredRevenueParams,
  RenewSubscriptionParams,
  SetSubscriptionCommitmentParams,
} from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function timestampFromInput(v: unknown, fallback = new Date()): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  return stbTimestampFromDate(fallback)
}

function parseU64List(v: unknown): bigint[] {
  if (v == null || String(v).trim() === '') return []
  return String(v)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s))
}

export function buildCreateDeferredRevenueScheduleParams(
  formData: Record<string, unknown>,
): CreateDeferredRevenueScheduleParams {
  const total = Number(formData.totalAmount ?? 0)
  const recognized = Number(formData.recognizedAmount ?? 0)
  const deferred = Math.max(0, total - recognized)

  return {
    description: String(formData.description ?? ""),
    journalId: BigInt(String(formData.journalId ?? 0)),
    accountId: BigInt(String(formData.accountId ?? 0)),
    deferredAccountId: BigInt(String(formData.deferredAccountId ?? 0)),
    currencyId: BigInt(String(formData.currencyId)),
    totalAmount: total,
    recognizedAmount: recognized,
    deferredAmount: deferred,
    startDate: timestampFromInput(formData.startDate),
    endDate: timestampFromInput(formData.endDate),
    recognitionMethod: String(formData.recognitionMethod ?? "straight_line"),
    recognitionPeriod: String(formData.recognitionPeriod ?? "month"),
    state: String(formData.state ?? "draft"),
    originMoveId: undefined,
    originMoveLineId: undefined,
    lineIds: [],
    journalEntryIds: [],
    notes: String(formData.notes ?? ""),
    metadata: undefined,
  }
}

export function buildCreateRevenueRecognitionRuleParams(
  formData: Record<string, unknown>,
): CreateRevenueRecognitionRuleParams {
  return {
    description: String(formData.description ?? ""),
    productCategoryIds: parseU64List(formData.productCategoryIds),
    productIds: parseU64List(formData.productIds),
    recognitionMethod: String(formData.recognitionMethod ?? "straight_line"),
    recognitionPeriod: String(formData.recognitionPeriod ?? "month"),
    recognitionAccountId: BigInt(String(formData.recognitionAccountId ?? 0)),
    deferredAccountId: BigInt(String(formData.deferredAccountId ?? 0)),
    expenseAccountId:
      formData.expenseAccountId != null && String(formData.expenseAccountId).trim() !== ""
        ? BigInt(String(formData.expenseAccountId))
        : undefined,
    priority: Number(formData.priority ?? 10),
    notes: String(formData.notes ?? ""),
    isActive: formData.isActive === true || formData.isActive === "true",
    metadata: undefined,
  }
}

export function buildRecognizeDeferredRevenueParams(
  formData: Record<string, unknown>,
): RecognizeDeferredRevenueParams {
  return stdbParamsToJson({
    moveId: BigInt(String(formData.moveId ?? 0)),
    moveLineId: BigInt(String(formData.moveLineId ?? 0)),
  }) as unknown as RecognizeDeferredRevenueParams
}

export function buildCloseSubscriptionParams(
  formData: Record<string, unknown>,
): CloseSubscriptionParams {
  return stdbParamsToJson({
    closeReasonId:
      formData.closeReasonId != null && String(formData.closeReasonId).trim() !== ''
        ? BigInt(String(formData.closeReasonId))
        : undefined,
    notes:
      formData.notes != null && String(formData.notes).trim() !== ''
        ? String(formData.notes)
        : undefined,
    noCharge:
      formData.noCharge === true ||
      formData.noCharge === 'true' ||
      formData.noCharge === 1 ||
      formData.noCharge === '1',
  }, "CloseSubscriptionParams") as unknown as CloseSubscriptionParams
}

export function buildGenerateSubscriptionInvoiceParams(
  formData: Record<string, unknown>,
): GenerateSubscriptionInvoiceParams {
  const incomeAccountId = BigInt(String(formData.incomeAccountId ?? 0))
  const receivableAccountId = BigInt(String(formData.receivableAccountId ?? 0))
  const journalRaw = formData.journalId
  const taxRaw = formData.taxAccountId
  return stdbParamsToJson({
    invoiceDate: timestampFromInput(formData.invoiceDate),
    billingRunKey:
      formData.billingRunKey != null && String(formData.billingRunKey).trim() !== ''
        ? String(formData.billingRunKey).trim()
        : undefined,
    journalId:
      journalRaw != null && String(journalRaw).trim() !== ''
        ? BigInt(String(journalRaw))
        : undefined,
    incomeAccountId,
    receivableAccountId,
    taxAccountId:
      taxRaw != null && String(taxRaw).trim() !== ''
        ? BigInt(String(taxRaw))
        : undefined,
  }, "GenerateSubscriptionInvoiceParams") as unknown as GenerateSubscriptionInvoiceParams
}

export function buildPaySubscriptionInvoiceParams(
  formData: Record<string, unknown>,
): ApplySubscriptionInvoicePaymentParams {
  const amountRaw = formData.amount
  return stdbParamsToJson({
    invoiceMoveId: BigInt(String(formData.invoiceMoveId ?? 0)),
    paymentJournalId: BigInt(String(formData.paymentJournalId ?? 0)),
    bankAccountId: BigInt(String(formData.bankAccountId ?? 0)),
    receivableAccountId: BigInt(String(formData.receivableAccountId ?? 0)),
    amount:
      amountRaw != null && String(amountRaw).trim() !== ''
        ? Number(amountRaw)
        : undefined,
    paymentDate:
      formData.paymentDate != null && String(formData.paymentDate).trim() !== ''
        ? timestampFromInput(formData.paymentDate)
        : undefined,
    cogsAccountId: BigInt(String(formData.cogsAccountId ?? formData.incomeAccountId ?? 0)),
    inventoryAccountId: BigInt(
      String(formData.inventoryAccountId ?? formData.cogsAccountId ?? formData.incomeAccountId ?? 0),
    ),
    ref:
      formData.ref != null && String(formData.ref).trim() !== ''
        ? String(formData.ref).trim()
        : undefined,
    memo:
      formData.memo != null && String(formData.memo).trim() !== ''
        ? String(formData.memo).trim()
        : undefined,
  }, "ApplySubscriptionInvoicePaymentParams") as unknown as ApplySubscriptionInvoicePaymentParams
}

export function buildAmendSubscriptionParams(
  formData: Record<string, unknown>,
): AmendSubscriptionParams {
  const prorate =
    formData.prorate === true ||
    formData.prorate === 'true' ||
    formData.prorate === 1 ||
    formData.prorate === '1' ||
    formData.prorate == null
  return stdbParamsToJson({
    amendmentType: String(formData.amendmentType ?? 'price'),
    lineId: BigInt(String(formData.lineId ?? 0)),
    effectiveDate:
      formData.effectiveDate != null && String(formData.effectiveDate).trim() !== ''
        ? timestampFromInput(formData.effectiveDate)
        : undefined,
    newProductId:
      formData.newProductId != null && String(formData.newProductId).trim() !== ''
        ? BigInt(String(formData.newProductId))
        : undefined,
    newQuantity:
      formData.newQuantity != null && String(formData.newQuantity).trim() !== ''
        ? Number(formData.newQuantity)
        : undefined,
    newPriceUnit:
      formData.newPriceUnit != null && String(formData.newPriceUnit).trim() !== ''
        ? Number(formData.newPriceUnit)
        : undefined,
    newDiscount:
      formData.newDiscount != null && String(formData.newDiscount).trim() !== ''
        ? Number(formData.newDiscount)
        : undefined,
    prorate,
    journalId:
      formData.journalId != null && String(formData.journalId).trim() !== ''
        ? BigInt(String(formData.journalId))
        : undefined,
    incomeAccountId:
      formData.incomeAccountId != null && String(formData.incomeAccountId).trim() !== ''
        ? BigInt(String(formData.incomeAccountId))
        : undefined,
    receivableAccountId:
      formData.receivableAccountId != null && String(formData.receivableAccountId).trim() !== ''
        ? BigInt(String(formData.receivableAccountId))
        : undefined,
    notes:
      formData.notes != null && String(formData.notes).trim() !== ''
        ? String(formData.notes).trim()
        : undefined,
  }, "AmendSubscriptionParams") as unknown as AmendSubscriptionParams
}

export function buildRenewSubscriptionParams(
  formData: Record<string, unknown>,
): RenewSubscriptionParams {
  return stdbParamsToJson({
    intervals: Math.max(1, Number(formData.intervals ?? 1)),
    notes:
      formData.notes != null && String(formData.notes).trim() !== ''
        ? String(formData.notes).trim()
        : undefined,
  }, "RenewSubscriptionParams") as unknown as RenewSubscriptionParams
}

export function buildCancelSubscriptionParams(
  formData: Record<string, unknown>,
): CancelSubscriptionParams {
  return stdbParamsToJson({
    closeReasonId:
      formData.closeReasonId != null && String(formData.closeReasonId).trim() !== ''
        ? BigInt(String(formData.closeReasonId))
        : undefined,
    notes:
      formData.notes != null && String(formData.notes).trim() !== ''
        ? String(formData.notes).trim()
        : undefined,
    createCreditNote:
      formData.createCreditNote === true ||
      formData.createCreditNote === 'true' ||
      formData.createCreditNote === 1 ||
      formData.createCreditNote === '1',
    invoiceMoveId:
      formData.invoiceMoveId != null && String(formData.invoiceMoveId).trim() !== ''
        ? BigInt(String(formData.invoiceMoveId))
        : undefined,
    prorateUnused:
      formData.prorateUnused === true ||
      formData.prorateUnused === 'true' ||
      formData.prorateUnused === 1 ||
      formData.prorateUnused === '1',
    journalId:
      formData.journalId != null && String(formData.journalId).trim() !== ''
        ? BigInt(String(formData.journalId))
        : undefined,
    incomeAccountId:
      formData.incomeAccountId != null && String(formData.incomeAccountId).trim() !== ''
        ? BigInt(String(formData.incomeAccountId))
        : undefined,
    receivableAccountId:
      formData.receivableAccountId != null && String(formData.receivableAccountId).trim() !== ''
        ? BigInt(String(formData.receivableAccountId))
        : undefined,
  }, "CancelSubscriptionParams") as unknown as CancelSubscriptionParams
}

export function buildIngestSubscriptionUsageEventParams(
  formData: Record<string, unknown>,
): IngestSubscriptionUsageEventParams {
  return stdbParamsToJson({
    source: String(formData.source ?? 'meter').trim() || 'meter',
    eventId: String(formData.eventId ?? '').trim(),
    quantity: Number(formData.quantity ?? 0),
    unit: String(formData.unit ?? 'unit').trim() || 'unit',
    productId:
      formData.productId != null && String(formData.productId).trim() !== ''
        ? BigInt(String(formData.productId))
        : undefined,
    occurredAt: undefined,
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata).trim()
        : undefined,
  }, "IngestSubscriptionUsageEventParams") as unknown as IngestSubscriptionUsageEventParams
}

export function buildCreateSubscriptionPriceTierParams(
  formData: Record<string, unknown>,
): CreateSubscriptionPriceTierParams {
  return stdbParamsToJson({
    planId: BigInt(String(formData.planId ?? 0)),
    productId:
      formData.productId != null && String(formData.productId).trim() !== ''
        ? BigInt(String(formData.productId))
        : undefined,
    sequence: Math.max(0, Number(formData.sequence ?? 1)),
    minQty: Number(formData.minQty ?? 0),
    maxQty:
      formData.maxQty != null && String(formData.maxQty).trim() !== ''
        ? Number(formData.maxQty)
        : undefined,
    unitPrice: Number(formData.unitPrice ?? 0),
    active: formData.active !== false && formData.active !== 'false',
    metadata: undefined,
  }, "CreateSubscriptionPriceTierParams") as unknown as CreateSubscriptionPriceTierParams
}

export function buildSetSubscriptionCommitmentParams(
  formData: Record<string, unknown>,
): SetSubscriptionCommitmentParams {
  return stdbParamsToJson({
    minAmount: Number(formData.minAmount ?? 0),
    productId:
      formData.productId != null && String(formData.productId).trim() !== ''
        ? BigInt(String(formData.productId))
        : undefined,
    active: formData.active !== false && formData.active !== 'false',
    metadata: undefined,
  }, "SetSubscriptionCommitmentParams") as unknown as SetSubscriptionCommitmentParams
}
