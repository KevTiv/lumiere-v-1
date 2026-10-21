import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import type { CreateSubscriptionPaymentIntentParams } from '@lumiere/stdb/types';

type Row = Record<string, unknown>;

/** Intent types `create_subscription_payment_intent` accepts. */
export const PAYMENT_INTENT_TYPES = ['card_charge', 'pix', 'boleto', 'paynow', 'fpx', 'qris', 'eft'] as const;

/** A fresh idempotency key; the caller makes one per dialog so a retried submit cannot double-create. */
export function newIdempotencyKey(): string {
  return `subscription-payment-intent:${globalThis.crypto.randomUUID()}`;
}

/**
 * Params for `create_subscription_payment_intent` (subscription:write): a known intent type, an
 * amount above zero, a currency and a non-blank idempotency key; the invoice move is optional.
 * `CreateSubscriptionPaymentIntentParams` is missing from the encoder's option-field table, so the
 * three options are spelled as SATS `some` / `none`. A blank invoice move means none; a filled but
 * unusable one is invalid rather than silently dropped.
 */
export function toPaymentIntentParams(
  values: Row | null | undefined,
  idempotencyKey: string,
): CreateSubscriptionPaymentIntentParams | null {
  if (values == null) return null;
  const key = idempotencyKey.trim();
  if (key === '') return null;
  const intentType = String(values.intentType ?? '').trim().toLowerCase();
  if (!(PAYMENT_INTENT_TYPES as readonly string[]).includes(intentType)) return null;
  const amountText = String(values.amount ?? '').trim();
  const amount = amountText === '' ? Number.NaN : Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currencyId = optionalBigIntU64(values.currencyId);
  if (currencyId == null || currencyId <= 0n) return null;

  const invoiceText = String(values.invoiceMoveId ?? '').trim();
  let invoiceMoveId: bigint | null = null;
  if (invoiceText !== '') {
    const parsed = optionalBigIntU64(invoiceText);
    if (parsed == null || parsed <= 0n) return null;
    invoiceMoveId = parsed;
  }

  return {
    intentType,
    idempotencyKey: key,
    invoiceMoveId: invoiceMoveId == null ? { none: [] } : { some: invoiceMoveId },
    paymentTokenId: { none: [] },
    amount,
    currencyId,
    fallbackDraftInvoice: false,
    metadata: { none: [] },
  } as unknown as CreateSubscriptionPaymentIntentParams;
}
