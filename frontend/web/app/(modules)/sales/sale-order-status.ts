import { isSaleOrderLocked, saleOrderState, type RowValueMap } from '@lumiere/erp-workflows';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type OrderRow = Record<string, unknown>;

export interface SaleOrderStatusStep {
  id: string;
  label: string;
}

/**
 * Where an order is in its life, for the status bar: quotation → sent → (approval) → sales order →
 * locked. A cancelled order is shown outside the flow.
 */
export function saleOrderStatusBar(
  order: OrderRow,
  t: Translate,
): { steps: SaleOrderStatusStep[]; current: string; terminal?: { label: string } } {
  const state = saleOrderState(order as RowValueMap);
  const steps: SaleOrderStatusStep[] = [
    { id: 'Draft', label: t('sales.order.status.quotation', { defaultValue: 'Quotation' }) },
    { id: 'Sent', label: t('sales.order.status.sent', { defaultValue: 'Quotation sent' }) },
    ...(state === 'ToApprove'
      ? [{ id: 'ToApprove', label: t('sales.order.status.toApprove', { defaultValue: 'To approve' }) }]
      : []),
    { id: 'Sale', label: t('sales.order.status.sale', { defaultValue: 'Sales order' }) },
    { id: 'Locked', label: t('sales.order.status.locked', { defaultValue: 'Locked' }) },
  ];
  if (state === 'Cancel' || state === 'Cancelled') {
    return {
      steps,
      current: '',
      terminal: { label: t('sales.order.status.cancelled', { defaultValue: 'Cancelled' }) },
    };
  }
  const locked = state === 'Done' || (state === 'Sale' && isSaleOrderLocked(order as RowValueMap));
  return { steps, current: locked ? 'Locked' : state };
}
