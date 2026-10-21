import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Where a manufacturing order's page lives. */
export function manufacturingOrderHref(order: Row): string | undefined {
  return order.id == null ? undefined : `/manufacturing/orders/${String(order.id)}`;
}

/**
 * Draft → confirmed → in progress → to close → done, with a planned stage between confirmed and
 * in progress only while the order is planned; a cancelled order is shown outside the flow.
 */
export function manufacturingOrderStatusBar(
  order: Row,
  t: Translate,
): { steps: Array<{ id: string; label: string }>; current: string; terminal?: { label: string } } {
  const state = variantTag(order.state);
  const label = (key: string, fallback: string) => t(`manufacturing.manufacturingOrders.states.${key}`, { defaultValue: fallback });
  const steps = [
    { id: 'Draft', label: label('Draft', 'Draft') },
    { id: 'Confirmed', label: label('Confirmed', 'Confirmed') },
    ...(state === 'Planned' ? [{ id: 'Planned', label: label('Planned', 'Planned') }] : []),
    { id: 'Progress', label: label('Progress', 'In progress') },
    { id: 'ToClose', label: label('ToClose', 'To close') },
    { id: 'Done', label: label('Done', 'Done') },
  ];
  if (state === 'Cancelled' || state === 'Cancel') {
    return { steps, current: '', terminal: { label: label('Cancelled', 'Cancelled') } };
  }
  return { steps, current: state };
}

/** Share of the planned quantity already produced, 0 to 100, or null when nothing is planned. */
export function producedPercent(order: Row): number | null {
  const planned = Number(order.productQty ?? order.product_qty);
  const produced = Number(order.qtyProduced ?? order.qty_produced ?? 0);
  if (!Number.isFinite(planned) || planned <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((produced / planned) * 100)));
}

/** The work orders of one manufacturing order. */
export function workordersOfOrder(workorders: ReadonlyArray<Row>, orderId: string): Row[] {
  return workorders.filter((row) => String(row.productionId ?? row.production_id ?? '') === orderId);
}
