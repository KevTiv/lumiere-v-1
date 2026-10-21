import { variantTag } from '@lumiere/erp-workflows';

type Row = Record<string, unknown>;

const EPSILON = 1e-9;

/** Quantity still to produce (never negative); zero when the plan or output is unreadable. */
export function remainingQty(order: Row): number {
  const planned = Number(order.productQty ?? order.product_qty);
  const produced = Number(order.qtyProduced ?? order.qty_produced ?? 0);
  if (!Number.isFinite(planned) || !Number.isFinite(produced)) return 0;
  return Math.max(0, planned - produced);
}

/** `confirm_manufacturing_order` accepts only a draft order. */
export function canConfirmOrder(order: Row): boolean {
  return variantTag(order.state) === 'Draft';
}

/** `start_manufacturing_order` accepts a confirmed or planned order. */
export function canStartOrder(order: Row): boolean {
  const state = variantTag(order.state);
  return state === 'Confirmed' || state === 'Planned';
}

/** `consume_mo_materials` accepts an order in progress or waiting to close. */
export function canConsumeMaterials(order: Row): boolean {
  const state = variantTag(order.state);
  return state === 'Progress' || state === 'ToClose';
}

/** `produce_manufacturing_order` needs an order in progress with quantity left to produce. */
export function canProduceOrder(order: Row): boolean {
  return variantTag(order.state) === 'Progress' && remainingQty(order) > EPSILON;
}

/** `finish_manufacturing_order` needs a to-close order whose full planned quantity is produced. */
export function canFinishOrder(order: Row): boolean {
  return variantTag(order.state) === 'ToClose' && remainingQty(order) <= EPSILON;
}

/** `cancel_manufacturing_order` rejects a done order; a cancelled one has nothing left to cancel. */
export function canCancelOrder(order: Row): boolean {
  const state = variantTag(order.state);
  return state !== 'Done' && state !== 'Cancelled' && state !== 'Cancel' && state !== '';
}

/** Work orders only run while their manufacturing order is in progress or to close. */
function orderRunsWorkorders(order: Row): boolean {
  const state = variantTag(order.state);
  return state === 'Progress' || state === 'ToClose';
}

/**
 * `start_workorder` accepts a pending or ready work order of a running order, once the work order
 * it is blocked by (if any) is done.
 */
export function canStartWorkorder(workorder: Row, order: Row, siblings: ReadonlyArray<Row>): boolean {
  const state = variantTag(workorder.state);
  if (state !== 'Pending' && state !== 'Ready') return false;
  if (!orderRunsWorkorders(order)) return false;
  const blocker = workorder.blockedByWorkorderId ?? workorder.blocked_by_workorder_id;
  if (blocker == null || String(blocker) === '') return true;
  const blocking = siblings.find((row) => String(row.id) === String(blocker));
  return blocking != null && variantTag(blocking.state) === 'Done';
}

/** `finish_workorder` accepts a work order in progress under a running order. */
export function canFinishWorkorder(workorder: Row, order: Row): boolean {
  return variantTag(workorder.state) === 'Progress' && orderRunsWorkorders(order);
}

/** Parse the quantity typed into the produce dialog; null unless it is a number within the remainder. */
export function parseProduceQty(value: unknown, order: Row): number | null {
  const qty = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty <= remainingQty(order) + EPSILON ? qty : null;
}
