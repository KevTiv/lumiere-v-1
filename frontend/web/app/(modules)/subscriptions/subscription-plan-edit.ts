import {
  PLAN_BILLING_PERIODS,
  normalizeBillingPeriod as normalizeSharedBillingPeriod,
  type PlanBillingPeriod,
} from '@lumiere/erp-shared/subscription-billing-periods';
import { optionalBigIntU64, unwrapSome } from '@lumiere/erp-shared/form-coercion';
import type { CreateSubscriptionBundleParams, UpdateSubscriptionPlanParams } from '@lumiere/stdb/types';

type Row = Record<string, unknown>;

export { PLAN_BILLING_PERIODS };
export type { PlanBillingPeriod };

/** Billing period as the reducer normalises it; null if unknown. */
export function normalizeBillingPeriod(raw: unknown): PlanBillingPeriod | null {
  return normalizeSharedBillingPeriod(unwrapSome(raw));
}

/** Payment modes the reducer stores. */
export const PLAN_PAYMENT_MODES = ['draft_invoice', 'automated_payment'] as const;
export type PlanPaymentMode = (typeof PLAN_PAYMENT_MODES)[number];

const NONE = { none: [] } as const;
const some = <T>(value: T) => ({ some: value });

function text(value: unknown): string {
  const unwrapped = unwrapSome(value);
  return unwrapped == null ? '' : String(unwrapped).trim();
}

/** Payment mode as the reducer normalises it (it also accepts manual/automatic); null if unknown. */
export function normalizePaymentMode(raw: unknown): PlanPaymentMode | null {
  switch (text(raw).toLowerCase()) {
    case 'draft_invoice':
    case 'manual':
      return 'draft_invoice';
    case 'automated_payment':
    case 'automatic':
      return 'automated_payment';
    default:
      return null;
  }
}

function integerAtLeast(raw: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  const s = text(raw);
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function num(raw: unknown, fallback: number): number {
  const s = text(raw);
  const n = s === '' ? Number.NaN : Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Current values of the editable plan fields, as the edit form shows them. */
export function planEditDefaults(plan: Row) {
  return {
    name: text(plan.name),
    code: text(plan.code),
    description: text(plan.description),
    billingPeriod: normalizeBillingPeriod(plan.billingPeriod ?? plan.billing_period) ?? 'month',
    billingPeriodUnit: num(plan.billingPeriodUnit ?? plan.billing_period_unit, 1),
    recurringInvoiceDay: num(plan.recurringInvoiceDay ?? plan.recurring_invoice_day, 1),
    paymentMode: normalizePaymentMode(plan.paymentMode ?? plan.payment_mode) ?? 'draft_invoice',
    trialPeriod: (plan.trialPeriod ?? plan.trial_period) === true,
    trialDuration: num(plan.trialDuration ?? plan.trial_duration, 0),
    isPublished: (plan.isPublished ?? plan.is_published) === true,
    isDefault: (plan.isDefault ?? plan.is_default) === true,
  };
}

export type PlanEditFailure =
  | 'name'
  | 'code'
  | 'billingPeriod'
  | 'billingPeriodUnit'
  | 'recurringInvoiceDay'
  | 'paymentMode'
  | 'trialDuration'
  | 'unchanged';

export type PlanEditResult =
  | { ok: true; params: UpdateSubscriptionPlanParams }
  | { ok: false; reason: PlanEditFailure };

/**
 * Params for `update_subscription_plan` (subscription_plan:write). `UpdateSubscriptionPlanParams`
 * is missing from the encoder's option-field table, so every option is spelled out as SATS
 * `some` / `none`: only changed fields are `some`, the rest (including currency, journal, product,
 * templates and metadata) stay `none` and keep their value. Billing period, payment mode and the
 * recurring invoice day (1..28) are validated the way the reducer does.
 */
export function toPlanUpdateParams(values: Row | null | undefined, plan: Row): PlanEditResult {
  if (values == null) return { ok: false, reason: 'name' };
  const current = planEditDefaults(plan);
  const wire: Record<string, unknown> = {
    name: NONE,
    description: NONE,
    code: NONE,
    currencyId: NONE,
    journalId: NONE,
    productId: NONE,
    billingPeriod: NONE,
    billingPeriodUnit: NONE,
    recurringInvoiceDay: NONE,
    trialPeriod: NONE,
    trialDuration: NONE,
    trialUnit: NONE,
    autoCloseLimit: NONE,
    paymentMode: NONE,
    templateId: NONE,
    invoiceMailTemplateId: NONE,
    websiteUrl: NONE,
    isPublished: NONE,
    isDefault: NONE,
    color: NONE,
    image1920Url: NONE,
    metadata: NONE,
  };
  let changed = false;

  const name = text(values.name);
  if (name === '') return { ok: false, reason: 'name' };
  if (name !== current.name) {
    wire.name = some(name);
    changed = true;
  }
  const code = text(values.code);
  if (code !== current.code) {
    if (code === '') return { ok: false, reason: 'code' };
    wire.code = some(code);
    changed = true;
  }
  const description = text(values.description);
  if (description !== current.description) {
    wire.description = some(description);
    changed = true;
  }

  const billingPeriod = normalizeBillingPeriod(values.billingPeriod);
  if (billingPeriod == null) return { ok: false, reason: 'billingPeriod' };
  if (billingPeriod !== current.billingPeriod) {
    wire.billingPeriod = some(billingPeriod);
    changed = true;
  }
  const billingPeriodUnit = integerAtLeast(values.billingPeriodUnit, 1, 4_294_967_295);
  if (billingPeriodUnit == null) return { ok: false, reason: 'billingPeriodUnit' };
  if (billingPeriodUnit !== current.billingPeriodUnit) {
    wire.billingPeriodUnit = some(billingPeriodUnit);
    changed = true;
  }
  const recurringInvoiceDay = integerAtLeast(values.recurringInvoiceDay, 1, 28);
  if (recurringInvoiceDay == null) return { ok: false, reason: 'recurringInvoiceDay' };
  if (recurringInvoiceDay !== current.recurringInvoiceDay) {
    wire.recurringInvoiceDay = some(recurringInvoiceDay);
    changed = true;
  }
  const paymentMode = normalizePaymentMode(values.paymentMode);
  if (paymentMode == null) return { ok: false, reason: 'paymentMode' };
  if (paymentMode !== current.paymentMode) {
    wire.paymentMode = some(paymentMode);
    changed = true;
  }

  const trialPeriod = Boolean(values.trialPeriod);
  if (trialPeriod !== current.trialPeriod) {
    wire.trialPeriod = some(trialPeriod);
    changed = true;
  }
  const trialDuration = integerAtLeast(values.trialDuration ?? 0, 0, 4_294_967_295);
  if (trialDuration == null) return { ok: false, reason: 'trialDuration' };
  if (trialDuration !== current.trialDuration) {
    wire.trialDuration = some(trialDuration);
    changed = true;
  }
  const isPublished = Boolean(values.isPublished);
  if (isPublished !== current.isPublished) {
    wire.isPublished = some(isPublished);
    changed = true;
  }
  const isDefault = Boolean(values.isDefault);
  if (isDefault !== current.isDefault) {
    wire.isDefault = some(isDefault);
    changed = true;
  }

  if (!changed) return { ok: false, reason: 'unchanged' };
  return { ok: true, params: wire as unknown as UpdateSubscriptionPlanParams };
}

/**
 * Params for `create_subscription_bundle` (subscription:write): an existing plan, a name and a
 * code (the reducer trims both and rejects blanks). `CreateSubscriptionBundleParams` is also
 * missing from the encoder's option-field table, so `metadata` is spelled as SATS `none`.
 */
export function toBundleCreateParams(
  values: Row | null | undefined,
  plans: readonly Row[],
): CreateSubscriptionBundleParams | null {
  if (values == null) return null;
  const planId = optionalBigIntU64(values.planId);
  if (planId == null || planId <= 0n || !plans.some((plan) => String(plan.id) === String(planId))) return null;
  const name = text(values.name);
  const code = text(values.code);
  if (name === '' || code === '') return null;
  return {
    planId,
    name,
    code,
    active: values.active !== false,
    metadata: NONE,
  } as unknown as CreateSubscriptionBundleParams;
}
