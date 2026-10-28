import { isSaleOrderLocked, normalizedTag, saleOrderState, type RowValueMap } from '@lumiere/erp-workflows';

export type SaleOrderNextStep = 'add-products' | 'send' | 'accept' | 'confirm' | 'approval' | 'invoice' | 'delivery' | 'review' | 'cancelled' | 'locked' | 'unavailable';

/** Presentation advice only. Canonical workflow actions and reducers still decide eligibility. */
export function saleOrderNextStep(order: RowValueMap, lines: readonly RowValueMap[], linesReady: boolean): SaleOrderNextStep {
  const state = saleOrderState(order);
  if (state === 'Cancel' || state === 'Cancelled') return 'cancelled';
  if (state === 'ToApprove') return 'approval';
  if (isSaleOrderLocked(order)) return 'locked';
  if (!linesReady) return 'unavailable';
  if (state === 'Draft' || state === 'Sent') {
    if (lines.length === 0) return 'add-products';
    if (state === 'Draft') return 'send';
    return String(order.signedBy ?? order.signed_by ?? '').trim() ? 'confirm' : 'accept';
  }
  if (state === 'Sale' || state === 'Done') {
    if (normalizedTag(order.invoiceStatus ?? order.invoice_status) === 'invoiced') return 'review';
    const invoicePolicy = normalizedTag(order.invoicePolicy ?? order.invoice_policy);
    if (invoicePolicy === 'delivery' && !lines.some((line) =>
      Number(line.qtyDelivered ?? line.qty_delivered ?? 0) > Number(line.qtyInvoiced ?? line.qty_invoiced ?? 0))) return 'delivery';
    return 'invoice';
  }
  return 'review';
}

export const nextStepActionIds: Partial<Record<SaleOrderNextStep, string>> = {
  send: 'sales.order.send-quotation', accept: 'sales.order.accept-quotation',
  confirm: 'sales.order.confirm', invoice: 'sales.order.create-invoice', locked: 'sales.order.unlock',
};
