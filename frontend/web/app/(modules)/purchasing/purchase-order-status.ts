import { variantTag } from '@lumiere/erp-workflows';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type OrderRow = Record<string, unknown>;

export interface PurchaseOrderStatusStep {
  id: string;
  label: string;
}

/**
 * Where a purchase order is in its life, for the status bar: RFQ → RFQ sent → (approval) →
 * purchase order → done. A cancelled order is shown outside the flow.
 */
export function purchaseOrderStatusBar(
  order: OrderRow,
  t: Translate,
): { steps: PurchaseOrderStatusStep[]; current: string; terminal?: { label: string } } {
  const state = variantTag(order.state);
  const steps: PurchaseOrderStatusStep[] = [
    { id: 'Draft', label: t('purchasing.order.status.rfq', { defaultValue: 'RFQ' }) },
    { id: 'Sent', label: t('purchasing.order.status.sent', { defaultValue: 'RFQ sent' }) },
    ...(state === 'ToApprove'
      ? [{ id: 'ToApprove', label: t('purchasing.order.status.toApprove', { defaultValue: 'To approve' }) }]
      : []),
    { id: 'Purchase', label: t('purchasing.order.status.purchase', { defaultValue: 'Purchase order' }) },
    { id: 'Done', label: t('purchasing.order.status.done', { defaultValue: 'Done' }) },
  ];
  if (state === 'Cancelled' || state === 'Cancel') {
    return {
      steps,
      current: '',
      terminal: { label: t('purchasing.order.status.cancelled', { defaultValue: 'Cancelled' }) },
    };
  }
  return { steps, current: state };
}
