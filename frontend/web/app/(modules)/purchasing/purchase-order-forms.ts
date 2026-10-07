/**
 * Pure helpers for the purchase order header / line / receive forms, shared by the list screen
 * and the order page so the two cannot drift.
 */

type Row = Record<string, unknown>;

/** Tag of an enum cell (`{ tag }`) or the plain value. */
export function enumTag(value: unknown): string {
  if (value != null && typeof value === 'object' && 'tag' in value) return String((value as { tag: string }).tag);
  return String(value ?? '');
}

export const purchaseOrderState = (row: Row): string => enumTag(row.state);
export const isPurchaseOrderLocked = (row: Row): boolean => (row.isLocked ?? row.is_locked) === true;

/** The reducers accept header and line edits only on an unlocked draft; lines can be added to any draft. */
export function canEditPurchaseOrder(order: Row): boolean {
  return purchaseOrderState(order) === 'Draft' && !isPurchaseOrderLocked(order);
}
export const canAddPurchaseOrderLine = (order: Row): boolean => purchaseOrderState(order) === 'Draft';
export const canRemovePurchaseOrderLine = canAddPurchaseOrderLine;

/** Locking is refused for finished orders. */
export function canLockPurchaseOrder(order: Row): boolean {
  const state = purchaseOrderState(order);
  return state !== 'Done' && state !== 'Cancelled' && !isPurchaseOrderLocked(order);
}
export const canUnlockPurchaseOrder = (order: Row): boolean => isPurchaseOrderLocked(order);

/**
 * Invoiced quantity can be recorded on a line only once more has been received than invoiced
 * (the list's invoice-quantity form offers exactly these lines; the reducer caps it at the ordered qty).
 */
export function canInvoicePurchaseOrderLine(line: Row): boolean {
  const received = Number(line.qtyReceived ?? line.qty_received ?? 0);
  const invoiced = Number(line.qtyInvoiced ?? line.qty_invoiced ?? 0);
  return received > invoiced;
}

const text = (value: unknown): string => (value == null ? '' : String(value));

/** Starting values of the edit-header form for a draft order. */
export function purchaseOrderHeaderDefaults(order: Row): Record<string, string> {
  return {
    orderId: String(order.id),
    partnerId: text(order.partnerId ?? order.partner_id),
    origin: text(order.origin),
    partnerRef: text(order.partnerRef ?? order.partner_ref),
    notes: text(order.notes),
    paymentTermId: text(order.paymentTermId ?? order.payment_term_id),
  };
}

/** Starting values of the edit-line form for a draft line. */
export function purchaseOrderLineEditDefaults(line: Row): Record<string, string> {
  return {
    lineId: String(line.id),
    productId: text(line.productId ?? line.product_id),
    uomId: text(line.productUom ?? line.product_uom ?? line.uomId),
    quantity: text(line.productQty ?? line.product_qty),
    priceUnit: text(line.priceUnit ?? line.price_unit),
  };
}

const filled = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
};

/** Reducer params of the edit-header form; blank fields are left unchanged. */
export function toUpdatePurchaseOrderHeaderArgs(
  formData: Record<string, unknown>,
): { orderId: string; params: Record<string, unknown> } | null {
  const orderId = filled(formData.orderId);
  if (orderId === undefined) return null;
  const params: Record<string, unknown> = {};
  const origin = filled(formData.origin);
  if (origin !== undefined) params.origin = origin;
  const partnerRef = filled(formData.partnerRef);
  if (partnerRef !== undefined) params.partnerRef = partnerRef;
  const notes = filled(formData.notes);
  if (notes !== undefined) params.notes = notes;
  const partnerId = filled(formData.partnerId);
  if (partnerId !== undefined) params.partnerId = BigInt(partnerId);
  const paymentTermId = filled(formData.paymentTermId);
  if (paymentTermId !== undefined) params.paymentTermId = BigInt(paymentTermId);
  if (formData.datePlanned != null && String(formData.datePlanned).trim() !== '') {
    params.datePlanned = formData.datePlanned;
  }
  return { orderId, params };
}

/** Workflow input of the receive-goods form (ids as strings, as the workflow expects). */
export function toReceiveLineInput(
  args: { lineId: number; qty: number; lotId?: number } | null,
): { lineId: string; qty: number; lotId?: string } | null {
  if (!args) return null;
  return {
    lineId: String(args.lineId),
    qty: args.qty,
    lotId: args.lotId == null ? undefined : String(args.lotId),
  };
}

/** The lines that belong to one order. */
export function linesOfOrder(lines: readonly Row[], orderId: string): Row[] {
  return lines.filter((line) => String(line.orderId ?? line.order_id ?? '') === orderId);
}
