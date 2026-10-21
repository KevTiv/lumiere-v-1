import { isPaymentRegistrable, variantTag } from '@lumiere/erp-workflows';
import { invoiceKind } from './invoice-status';

type Row = Record<string, unknown>;

/** Cancellation does not undo posting effects, so an ever-posted move cannot reset. */
export function canResetMove(move: Row): boolean {
  return variantTag(move.state) === 'Cancelled' && (move.postedBefore ?? move.posted_before) === false;
}

/** Direct cancellation is draft-only. Posted moves require a credit note or reversal. */
export function canCancelMove(move: Row): boolean {
  return variantTag(move.state) === 'Draft';
}

/** `add_`, `update_` and `delete_account_move_line` accept only lines of a draft move. */
export function canEditMoveLines(move: Row): boolean {
  return variantTag(move.state) === 'Draft';
}

/** `compute_invoice_totals` rejects plain journal entries; invoices, bills and their refunds can recompute. */
export function canRecomputeInvoiceTotals(kind: string): boolean {
  return kind !== 'entry';
}

/** A posted customer invoice or vendor bill that still has an open balance can take a payment. */
export function canRegisterPayment(move: Row, kind: string): boolean {
  return (
    variantTag(move.state) === 'Posted' &&
    Number(move.amountResidual ?? move.amount_residual ?? 0) > 0 &&
    (kind === 'invoice' || kind === 'bill')
  );
}

function companyOf(row: Row): string {
  const value = row.companyId ?? row.company_id;
  return value == null ? '' : String(value);
}

/**
 * Posted payments (`Paid`) that can be applied to this document. Payments of another company are
 * left out, because applying across companies is never confirmed by the backend readback.
 */
export function registrablePayments(payments: readonly Row[], move: Row): Row[] {
  const company = companyOf(move);
  return payments.filter((payment) => {
    if (!isPaymentRegistrable(payment)) return false;
    const paymentCompany = companyOf(payment);
    return company === '' || paymentCompany === '' || company === paymentCompany;
  });
}

export function paymentOptionLabel(payment: Row): string {
  const id = String(payment.id ?? '');
  const ref = String(payment.ref ?? payment.name ?? '').trim();
  const amount = payment.amount != null ? ` (${String(payment.amount)})` : '';
  return `${ref || `Payment #${id}`}${amount}`;
}

/** `reconcile_payment_with_invoice` needs a posted document with an open balance; refunds and entries are not targets. */
export function canReconcilePayment(move: Row, kind: string): boolean {
  return canRegisterPayment(move, kind);
}

function partnerOf(row: Row): string {
  const value = row.partnerId ?? row.partner_id;
  return value == null ? '' : String(value);
}

/**
 * Posted journal entries (payment moves) that can be reconciled against this invoice: same company,
 * same partner when both sides name one, and not already fully applied. The backend applies
 * min(payment residual, invoice residual); there is no amount argument.
 */
export function reconcilablePaymentMoves(moves: readonly Row[], invoice: Row): Row[] {
  const company = companyOf(invoice);
  const partner = partnerOf(invoice);
  return moves.filter((candidate) => {
    if (String(candidate.id) === String(invoice.id)) return false;
    if (variantTag(candidate.state) !== 'Posted') return false;
    if (invoiceKind(candidate) !== 'entry') return false;
    const candidateCompany = companyOf(candidate);
    if (company !== '' && candidateCompany !== '' && company !== candidateCompany) return false;
    const candidatePartner = partnerOf(candidate);
    if (partner !== '' && candidatePartner !== '' && partner !== candidatePartner) return false;
    const residual = candidate.amountResidual ?? candidate.amount_residual;
    return residual == null || Number(residual) > 0;
  });
}
