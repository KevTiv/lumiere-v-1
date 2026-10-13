import { variantTag } from '@lumiere/erp-workflows';
import type { CreateReturnOrderParams } from '@lumiere/stdb/types';

type Row = Record<string, unknown>;

const EPSILON = 1e-9;

function deliveredQty(line: Row): number {
  const qty = Number(line.qtyDelivered ?? line.qty_delivered ?? 0);
  return Number.isFinite(qty) ? qty : 0;
}

function toBigInt(value: unknown): bigint | null {
  if (value == null || String(value).trim() === '') return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

/** Lines with something delivered; `create_return_order` caps each return line at that quantity. */
export function returnableLines(lines: ReadonlyArray<Row>): Row[] {
  return lines.filter((line) => deliveredQty(line) > EPSILON);
}

/** A return needs a confirmed (sale or done) order that has delivered something. */
export function canCreateReturn(order: Row, lines: ReadonlyArray<Row>): boolean {
  const state = variantTag(order.state);
  return (state === 'Sale' || state === 'Done') && returnableLines(lines).length > 0;
}

/** Id of the form field that carries the return quantity of one order line. */
export function returnQtyFieldId(line: Row): string {
  return `qty_${String(line.id)}`;
}

/**
 * Build the `create_return_order` params from the dialog values. Lines left blank or at zero are
 * skipped; null when nothing is returned, a quantity is invalid or exceeds what was delivered.
 */
export function buildReturnParams(
  order: Row,
  lines: ReadonlyArray<Row>,
  values: Record<string, unknown>,
): CreateReturnOrderParams | null {
  const partnerId = toBigInt(order.partnerId ?? order.partner_id);
  const saleOrderId = toBigInt(order.id);
  if (partnerId == null || saleOrderId == null) return null;
  const params: CreateReturnOrderParams['lines'] = [];
  for (const line of returnableLines(lines)) {
    const raw = values[returnQtyFieldId(line)];
    if (raw == null || String(raw).trim() === '') continue;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0) return null;
    if (qty === 0) continue;
    if (qty > deliveredQty(line) + EPSILON) return null;
    const lineId = toBigInt(line.id);
    const productId = toBigInt(line.productId ?? line.product_id);
    const productUom = toBigInt(line.productUom ?? line.product_uom ?? line.uomId);
    const priceUnit = Number(line.priceUnit ?? line.price_unit ?? 0);
    if (lineId == null || productId == null || productUom == null || !Number.isFinite(priceUnit)) return null;
    params.push({
      saleOrderLineId: lineId,
      productId,
      productUom,
      productUomQty: qty,
      priceUnit,
      toRefund: true,
      lotId: undefined,
    });
  }
  if (params.length === 0) return null;
  const reason = typeof values.reason === 'string' ? values.reason.trim() : '';
  return {
    partnerId,
    saleOrderId,
    returnReason: reason || undefined,
    lines: params,
    // The return workflow assigns one key per submission.
    idempotencyKey: undefined,
  };
}
