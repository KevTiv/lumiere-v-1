/** Quantity guidance only. Posting remains authoritative for price and provenance checks. */
export type PoLineMatchStatus = 'matched' | 'pending' | 'under_received' | 'over_received' | 'under_billed' | 'over_billed' | 'unavailable';
interface Row { [field: string]: unknown }
function quantity(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
function tag(value: unknown): string {
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'tag' in value ? String(value.tag) : '';
}
export function purchaseMatchRecovery(line: Row, order?: Row) {
  const ordered = quantity(line.productQty ?? line.product_qty);
  const received = quantity(line.qtyReceived ?? line.qty_received);
  const billed = quantity(line.qtyInvoiced ?? line.qty_invoiced);
  const configured = order?.matchQtyTolerance ?? order?.match_qty_tolerance;
  const tolerance = configured == null ? 0.001 : quantity(configured);
  if (ordered == null || received == null || billed == null || tolerance == null) {
    return { status: 'unavailable' as PoLineMatchStatus, guidance: 'unavailable', receiptQty: null, variance: 0 };
  }
  let status: PoLineMatchStatus = 'pending';
  if (received > ordered + tolerance) status = 'over_received';
  else if (billed > received + tolerance || billed > ordered + tolerance) status = 'over_billed';
  else if (received <= tolerance && billed <= tolerance) status = 'pending';
  else if (Math.abs(received - billed) <= tolerance) status = 'matched';
  else if (billed < received - tolerance) status = 'under_billed';
  else if (received < ordered - tolerance) status = 'under_received';
  const sameOrder = order?.id != null && String(order.id) === String(line.orderId ?? line.order_id);
  // PO confirmation currently leaves its existing lines in Draft; the confirmed header is the
  // authoritative receipt gate in the reducer. Imported/legacy rows may already be Confirmed.
  const lineState = tag(line.state);
  const canReceive = sameOrder && tag(order?.state) === 'Purchase'
    && (lineState === 'Draft' || lineState === 'Confirmed');
  const shortage = billed - received;
  // Never suggest receiving beyond the order to conceal an incorrect bill.
  const receiptQty = canReceive && status === 'over_billed' && billed <= ordered && shortage > tolerance ? shortage : null;
  const guidance = status === 'over_billed'
    ? receiptQty == null ? 'reviewBill' : 'receiveOrReviewBill'
    : status === 'over_received' ? 'reviewReceipt'
    : status === 'under_billed' ? 'reviewUnbilled'
    : status === 'matched' ? 'quantityAligned' : 'awaitReceipt';
  const variance = status === 'over_billed' || status === 'under_billed' ? billed - received
    : status === 'over_received' || status === 'under_received' ? received - ordered : 0;
  return { status, guidance, receiptQty, variance };
}
