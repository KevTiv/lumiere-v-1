import { variantTag } from '@lumiere/erp-workflows';

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Row = Record<string, unknown>;

/**
 * Where a stock transfer is, for the status bar: draft → waiting → ready → done. A transfer that
 * is still waiting for stock or for a preceding move sits on the waiting stage; a cancelled one is
 * shown outside the flow.
 */
export function transferStatusBar(
  transfer: Row,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string; terminal?: { label: string } } {
  const state = variantTag(transfer.state).toLowerCase();
  const steps = [
    { id: 'draft', label: t('inventory.transfers.states.draft', { defaultValue: 'Draft' }) },
    { id: 'confirmed', label: t('inventory.transfers.states.waiting', { defaultValue: 'Waiting' }) },
    { id: 'assigned', label: t('inventory.transfers.states.assigned', { defaultValue: 'Ready' }) },
    { id: 'done', label: t('inventory.transfers.states.done', { defaultValue: 'Done' }) },
  ];
  if (state === 'cancel' || state === 'cancelled') {
    return {
      steps,
      current: '',
      terminal: { label: t('inventory.transfers.states.cancel', { defaultValue: 'Cancelled' }) },
    };
  }
  return { steps, current: state === 'waiting' ? 'confirmed' : state };
}
