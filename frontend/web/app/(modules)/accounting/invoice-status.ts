import { variantTag } from '@lumiere/erp-workflows';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type MoveRow = Record<string, unknown>;

export type InvoiceBadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export interface InvoiceStatus {
  steps: Array<{ id: string; label: string }>;
  /** Id of the stage the document is in; empty for a cancelled one. */
  current: string;
  terminal?: { label: string };
  /** The payment position the header badge shows: overdue, partly paid, paid, not paid. */
  badge: { label: string; variant: InvoiceBadgeVariant };
}

/** Milliseconds since the epoch of a timestamp cell (`{ microsSinceUnixEpoch }`, micros, or none). */
function dueMs(value: unknown): number | null {
  if (value == null) return null;
  const raw =
    typeof value === 'object' && 'microsSinceUnixEpoch' in value
      ? (value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch
      : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? n / 1000 : n;
}

/**
 * Where an invoice or bill is in its life, for the status bar (draft → posted → paid), and the
 * payment position for the header badge. A cancelled document is shown outside the flow.
 */
export function invoiceStatus(move: MoveRow, t: Translate, now: number = Date.now()): InvoiceStatus {
  const state = variantTag(move.state);
  const paymentState = variantTag(move.paymentState ?? move.payment_state);
  const residual = Number(move.amountResidual ?? move.amount_residual ?? 0);
  const steps = [
    { id: 'Draft', label: t('accounting.states.draft', { defaultValue: 'Draft' }) },
    { id: 'Posted', label: t('accounting.states.posted', { defaultValue: 'Posted' }) },
    { id: 'Paid', label: t('accounting.states.paid', { defaultValue: 'Paid' }) },
  ];

  if (state === 'Cancelled' || state === 'Cancel') {
    const label = t('accounting.states.cancelled', { defaultValue: 'Cancelled' });
    return { steps, current: '', terminal: { label }, badge: { label, variant: 'destructive' } };
  }
  if (state === 'Draft') {
    return { steps, current: 'Draft', badge: { label: steps[0]!.label, variant: 'secondary' } };
  }
  if (paymentState === 'Paid') {
    return { steps, current: 'Paid', badge: { label: steps[2]!.label, variant: 'default' } };
  }
  const due = dueMs(move.invoiceDateDue ?? move.invoice_date_due);
  if (residual > 0 && due != null && due < now) {
    return {
      steps,
      current: 'Posted',
      badge: { label: t('accounting.states.overdue', { defaultValue: 'Overdue' }), variant: 'destructive' },
    };
  }
  if (paymentState === 'InPayment' || paymentState === 'Partial') {
    return {
      steps,
      current: 'Posted',
      badge: { label: t('accounting.states.partial', { defaultValue: 'Partially paid' }), variant: 'outline' },
    };
  }
  return {
    steps,
    current: 'Posted',
    badge: { label: t('accounting.states.notPaid', { defaultValue: 'Not paid' }), variant: 'secondary' },
  };
}

/** What kind of document a move is, for titles and the list it belongs to. */
export function invoiceKind(move: MoveRow): 'invoice' | 'bill' | 'creditNote' | 'vendorCredit' | 'entry' {
  switch (variantTag(move.moveType ?? move.move_type).toLowerCase()) {
    case 'outinvoice':
      return 'invoice';
    case 'ininvoice':
      return 'bill';
    case 'outrefund':
      return 'creditNote';
    case 'inrefund':
      return 'vendorCredit';
    default:
      return 'entry';
  }
}
