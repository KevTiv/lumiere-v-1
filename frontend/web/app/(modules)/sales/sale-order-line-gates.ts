type Row = Record<string, unknown>;

function stateTag(value: unknown): string {
  if (value != null && typeof value === 'object' && 'tag' in value) return String((value as { tag: unknown }).tag);
  return String(value ?? '');
}

/**
 * `delete_sale_order_line` needs the parent order unlocked and Draft or Sent. A line whose order is
 * not among the loaded orders stays applicable, so the server still has the last word.
 */
export function saleOrderLineCanBeDeleted(line: Row, orders: readonly Row[]): boolean {
  const orderId = line.orderId ?? line.order_id;
  if (orderId == null) return true;
  const order = orders.find((candidate) => String(candidate.id) === String(orderId));
  if (order == null) return true;
  if (order.isLocked === true || order.is_locked === true) return false;
  const state = stateTag(order.state);
  return state === 'Draft' || state === 'Sent';
}
