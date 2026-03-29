/**
 * Maps Subscriptions / revenue recognition form payloads to SpacetimeDB reducer bodies.
 */

import type {
  CloseSubscriptionParams,
  CreateDeferredRevenueScheduleParams,
  CreateRevenueRecognitionRuleParams,
  GenerateSubscriptionInvoiceParams,
  RecognizeDeferredRevenueParams,
} from '@lumiere/stdb'
import { Timestamp } from 'spacetimedb'

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function timestampFromInput(v: unknown, fallback = new Date()): Timestamp {
  if (v != null && String(v).trim() !== '') {
    const d = new Date(String(v))
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d)
  }
  return Timestamp.fromDate(fallback)
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
  const deferred = Number.isFinite(Number(formData.deferredAmount))
    ? Number(formData.deferredAmount)
    : Math.max(0, total - recognized)

  return stdbParamsToJson({
    description: String(formData.description ?? ''),
    journalId: BigInt(String(formData.journalId ?? 0)),
    accountId: BigInt(String(formData.accountId ?? 0)),
    deferredAccountId: BigInt(String(formData.deferredAccountId ?? 0)),
    currencyId: BigInt(String(formData.currencyId ?? 1)),
    totalAmount: total,
    recognizedAmount: recognized,
    deferredAmount: deferred,
    startDate: timestampFromInput(formData.startDate),
    endDate: timestampFromInput(formData.endDate),
    recognitionMethod: String(formData.recognitionMethod ?? 'straight_line'),
    recognitionPeriod: String(formData.recognitionPeriod ?? 'month'),
    state: String(formData.state ?? 'draft'),
    originMoveId:
      formData.originMoveId != null && String(formData.originMoveId).trim() !== ''
        ? BigInt(String(formData.originMoveId))
        : undefined,
    originMoveLineId:
      formData.originMoveLineId != null && String(formData.originMoveLineId).trim() !== ''
        ? BigInt(String(formData.originMoveLineId))
        : undefined,
    lineIds: [],
    journalEntryIds: [],
    notes: String(formData.notes ?? ''),
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata)
        : undefined,
  }) as unknown as CreateDeferredRevenueScheduleParams
}

export function buildCreateRevenueRecognitionRuleParams(
  formData: Record<string, unknown>,
): CreateRevenueRecognitionRuleParams {
  return stdbParamsToJson({
    description: String(formData.description ?? ''),
    productCategoryIds: parseU64List(formData.productCategoryIds),
    productIds: parseU64List(formData.productIds),
    recognitionMethod: String(formData.recognitionMethod ?? 'straight_line'),
    recognitionPeriod: String(formData.recognitionPeriod ?? 'month'),
    recognitionAccountId: BigInt(String(formData.recognitionAccountId ?? 0)),
    deferredAccountId: BigInt(String(formData.deferredAccountId ?? 0)),
    expenseAccountId:
      formData.expenseAccountId != null && String(formData.expenseAccountId).trim() !== ''
        ? BigInt(String(formData.expenseAccountId))
        : undefined,
    priority: Number(formData.priority ?? 10),
    notes: String(formData.notes ?? ''),
    isActive: formData.isActive === true || formData.isActive === 'true',
    metadata:
      formData.metadata != null && String(formData.metadata).trim() !== ''
        ? String(formData.metadata)
        : undefined,
  }) as unknown as CreateRevenueRecognitionRuleParams
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
  }) as unknown as CloseSubscriptionParams
}

export function buildGenerateSubscriptionInvoiceParams(
  formData: Record<string, unknown>,
): GenerateSubscriptionInvoiceParams {
  return stdbParamsToJson({
    invoiceDate: timestampFromInput(formData.invoiceDate),
  }) as unknown as GenerateSubscriptionInvoiceParams
}
