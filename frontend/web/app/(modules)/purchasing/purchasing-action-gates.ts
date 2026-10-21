import { normalizedTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

function identityHex(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && '__identity__' in value) {
    return String((value as { __identity__: unknown }).__identity__)
      .trim()
      .replace(/^0x/i, '')
      .toLowerCase();
  }
  return String(value).trim().replace(/^0x/i, '').toLowerCase();
}

/** An in-progress requisition must be decided by someone other than its requester. */
export function requisitionCanApprove(requisition: Row, actorIdentity: unknown): boolean {
  if (normalizedTag(requisition.state) !== 'inprogress') return false;
  const requester = identityHex(requisition.userId ?? requisition.user_id);
  const actor = identityHex(actorIdentity);
  return requester !== '' && actor !== '' && requester !== actor;
}

/** `create_purchase_rfq` rejects a requisition that is not Approved. */
export function requisitionCanCreateRfq(requisition: Row): boolean {
  return normalizedTag(requisition.state) === 'approved';
}

/**
 * `remove_purchase_order_line` only works while the parent order is Draft. A line whose order is not
 * among the loaded orders stays applicable (nothing to judge by), so the server still has the last word.
 */
export function purchaseOrderLineCanBeRemoved(line: Row, orders: readonly Row[]): boolean {
  const orderId = line.orderId ?? line.order_id;
  if (orderId == null) return true;
  const order = orders.find((candidate) => String(candidate.id) === String(orderId));
  return order == null || normalizedTag(order.state) === 'draft';
}
