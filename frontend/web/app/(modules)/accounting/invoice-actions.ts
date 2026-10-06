import { isPaymentRegistrable, variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

/** `cancel_account_move` accepts only draft or posted moves. */
export function canCancelMove(move: Row): boolean {
  const state = variantTag(move.state);
  return state === 'Draft' || state === 'Posted';
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
