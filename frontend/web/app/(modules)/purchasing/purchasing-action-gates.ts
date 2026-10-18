type Row = Record<string, unknown>;

function stateTag(value: unknown): string {
  if (value != null && typeof value === 'object' && 'tag' in value) return String((value as { tag: unknown }).tag);
  return String(value ?? '');
}

/** `create_purchase_rfq` rejects a requisition that is not Approved. */
export function requisitionCanCreateRfq(requisition: Row): boolean {
  return stateTag(requisition.state) === 'Approved';
}

/**
 * `remove_purchase_order_line` only works while the parent order is Draft. A line whose order is not
 * among the loaded orders stays applicable (nothing to judge by), so the server still has the last word.
 */
export function purchaseOrderLineCanBeRemoved(line: Row, orders: readonly Row[]): boolean {
  const orderId = line.orderId ?? line.order_id;
  if (orderId == null) return true;
  const order = orders.find((candidate) => String(candidate.id) === String(orderId));
  return order == null || stateTag(order.state) === 'Draft';
}
