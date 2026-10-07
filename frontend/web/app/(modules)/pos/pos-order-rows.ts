import { variantTag } from '@lumiere/erp-workflows';
import { timestampToIso } from '@lumiere/erp-shared/timestamp-values';

type Row = Record<string, unknown>;

/** Flatten one `/api/query/pos-orders` row (hot or cold) for the orders table. */
export function posOrderDisplayRow(order: Row): Row {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');
  const reference =
    text(order.ticketNumber ?? order.ticket_number) ||
    text(order.posReference ?? order.pos_reference) ||
    text(order.uid) ||
    (order.id == null ? '' : `#${String(order.id)}`);
  const partnerId = order.partnerId ?? order.partner_id;
  const partner = partnerId == null || typeof partnerId === 'object' ? '' : `#${String(partnerId)}`;
  const rawDate = order.dateOrder ?? order.date_order;
  return {
    id: order.id,
    reference,
    state: variantTag(order.state),
    amountTotal: Number(order.amountTotal ?? order.amount_total ?? 0),
    partner,
    dateOrder: rawDate == null ? null : timestampToIso(rawDate),
  };
}
