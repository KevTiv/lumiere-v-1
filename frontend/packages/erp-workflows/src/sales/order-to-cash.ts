import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import { recordAction, type WorkflowAction, type WorkflowExecuteContext } from "../core/action"
import { recordRef } from "../core/record-ref"
import type { WorkflowResult } from "../core/result"
import { rowId, variantTag } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"
import { invoiceWorkflow } from "../accounting/invoice-to-payment"
import { pickingWorkflow } from "../inventory/fulfillment"

export const saleOrderWorkflow = defineWorkflow({
  id: "sales.order",
  resource: "sale_order",
  module: "sales",
})

/** Everything `confirm_sales_order` can change: the order, its lines, and the pickings it spawns. */
export const CONFIRM_SALE_ORDER_AFFECTS = [
  "sale-orders",
  "sale-orders-to-approve",
  "sale-order-lines",
  "picking-batches",
  "stock-pickings",
  "stock-moves",
] as const

export function saleOrderState(row: RowValueMap): string {
  return variantTag(firstNonNullKey(row, "state"))
}

/** Presentation gate only: the reducer re-validates state, credit, approval and permission. */
export function isSaleOrderConfirmable(row: RowValueMap): boolean {
  const state = saleOrderState(row)
  return state === "Draft" || state === "Sent"
}

const CONFIRMED_STATES = new Set(["Sale", "Done"])

export function isSaleOrderConfirmed(row: RowValueMap): boolean {
  return CONFIRMED_STATES.has(saleOrderState(row))
}

/**
 * Resolve the canonical result of a confirm from post-command reads.
 *
 * `confirm_sales_order` returns success without changing state when it hands the order to an
 * approval task, so an unchanged order means approval is pending, not that nothing happened.
 */
export function observeConfirmedOrder(
  orderId: string,
  orders: readonly RowValueMap[],
  pickings: readonly RowValueMap[],
): ObservedTransition {
  const order = orders.find((row) => rowId(row) === orderId)
  if (!order) return {}
  const orderRef = recordRef(saleOrderWorkflow.resource, orderId, saleOrderWorkflow.module)

  if (!isSaleOrderConfirmed(order)) {
    return { outcome: "approval_pending", next: orderRef }
  }

  const deliveries = pickings
    .filter((row) => {
      const saleId = firstNonNullKey(row, "saleId", "sale_id")
      const isReturn = Boolean(firstNonNullKey(row, "isReturn", "is_return"))
      return saleId != null && String(saleId) === orderId && !isReturn
    })
    .map((row) => recordRef(pickingWorkflow.resource, rowId(row), pickingWorkflow.module, saleOrderWorkflow.module))

  return {
    outcome: "applied",
    createdRecords: deliveries.length > 0 ? deliveries : undefined,
    next: deliveries[0] ?? orderRef,
  }
}

export function confirmSaleOrderAction(options: {
  label: string
  execute(orderId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return {
    id: "sales.order.confirm",
    label: options.label,
    kind: "immediate",
    canPresent: isSaleOrderConfirmable,
    prepare: rowId,
    execute: options.execute,
  }
}

/** `send_sale_order_quotation` moves a Draft order to Sent. */
export const SEND_SALE_ORDER_QUOTATION_AFFECTS = ["sale-orders", "sale-orders-to-approve"] as const

/** `accept_sale_order_quotation` records the signature on the order; the state stays Sent. */
export const ACCEPT_SALE_ORDER_QUOTATION_AFFECTS = ["sale-orders"] as const

/**
 * Everything `cancel_sale_order` changes: the order and its lines, the open deliveries it
 * cancels (with their moves and released reservations) and the commissions it reverses.
 */
export const CANCEL_SALE_ORDER_AFFECTS = [
  "sale-orders",
  "sale-orders-to-approve",
  "sale-order-lines",
  "sale-commissions",
  "sale-commissions-pending",
  "stock-pickings",
  "stock-moves",
  "stock-quants",
] as const

/** Presentation gates only: the reducers re-validate state, lines, expiry, lock and permission. */
export const isSaleOrderSendable = (row: RowValueMap): boolean => saleOrderState(row) === "Draft"

export const isSaleOrderAcceptable = (row: RowValueMap): boolean => saleOrderState(row) === "Sent"

const NON_CANCELLABLE_STATES = new Set(["Done", "Cancelled", "Cancel"])

/**
 * Anything not finished or already cancelled. An invoiced order is still presented: the reducer
 * refuses it and the surface explains that a return and credit note is the path instead.
 */
export const isSaleOrderCancellable = (row: RowValueMap): boolean => !NON_CANCELLABLE_STATES.has(saleOrderState(row))

export function sendSaleOrderQuotationAction(options: {
  label: string
  execute(orderId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return recordAction("sales.order.send-quotation", "immediate", isSaleOrderSendable, options)
}

export function cancelSaleOrderAction(options: {
  label: string
  execute(orderId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return recordAction("sales.order.cancel", "destructive", isSaleOrderCancellable, options)
}

export interface AcceptSaleOrderQuotationInput {
  orderId: string
  signedBy: string
  signature?: string | null
}

/** Form-backed: the surface collects who accepted (and optionally a signature) before dispatching. */
export function acceptSaleOrderQuotationAction(options: {
  label: string
  execute(input: AcceptSaleOrderQuotationInput, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, AcceptSaleOrderQuotationInput> {
  return {
    id: "sales.order.accept-quotation",
    label: options.label,
    kind: "form",
    canPresent: isSaleOrderAcceptable,
    execute: options.execute,
  }
}

/** `compute_so_totals` rewrites the order's amounts from its lines. */
export const COMPUTE_SALE_ORDER_TOTALS_AFFECTS = ["sale-orders", "sale-order-lines"] as const

/** `lock_sale_order` / `unlock_sale_order` only flip the order's `is_locked` flag. */
export const SALE_ORDER_LOCK_AFFECTS = ["sale-orders"] as const

/** `update_sale_order` edits header fields and can re-price lines (pricelist, warehouse). */
export const UPDATE_SALE_ORDER_AFFECTS = ["sale-orders", "sale-order-lines"] as const

export const isSaleOrderLocked = (row: RowValueMap): boolean =>
  Boolean(firstNonNullKey(row, "isLocked", "is_locked"))

/** Totals can be recomputed for any order that has not been cancelled. */
export const isSaleOrderTotalsComputable = (row: RowValueMap): boolean =>
  saleOrderState(row) !== "Cancelled" && saleOrderState(row) !== "Cancel"

/** A locked order is offered unlock instead; finished or cancelled orders cannot be locked. */
export const isSaleOrderLockable = (row: RowValueMap): boolean =>
  !isSaleOrderLocked(row) && isSaleOrderCancellable(row)

export const isSaleOrderUnlockable = isSaleOrderLocked

/** Header edits are open to unlocked quotations (Draft or Sent). */
export const isSaleOrderEditable = (row: RowValueMap): boolean => {
  const state = saleOrderState(row)
  return (state === "Draft" || state === "Sent") && !isSaleOrderLocked(row)
}

interface OrderRecordActionOptions {
  label: string
  execute(orderId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}

export const computeSaleOrderTotalsAction = (o: OrderRecordActionOptions) =>
  recordAction("sales.order.compute-totals", "immediate", isSaleOrderTotalsComputable, o)

export const lockSaleOrderAction = (o: OrderRecordActionOptions) =>
  recordAction("sales.order.lock", "immediate", isSaleOrderLockable, o)

export const unlockSaleOrderAction = (o: OrderRecordActionOptions) =>
  recordAction("sales.order.unlock", "immediate", isSaleOrderUnlockable, o)

export interface UpdateSaleOrderInput<TParams> {
  orderId: string
  params: TParams
}

/** Form-backed: the surface collects the header fields, then dispatches the changed params. */
export function updateSaleOrderAction<TParams>(options: {
  label: string
  execute(input: UpdateSaleOrderInput<TParams>, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, UpdateSaleOrderInput<TParams>> {
  return {
    id: "sales.order.update",
    label: options.label,
    kind: "form",
    canPresent: isSaleOrderEditable,
    execute: options.execute,
  }
}

/** Everything `create_invoice_from_sale_order` changes: the order's invoicing state and the new draft move. */
export const CREATE_INVOICE_FROM_SALE_ORDER_AFFECTS = [
  "sale-orders",
  "sale-order-lines",
  "account-moves",
  "account-move-lines",
] as const

/**
 * Presentation gate only: a confirmed order that is not fully invoiced. Whether anything is
 * deliverable/invoiceable yet is decided by the reducer from delivered quantities.
 */
export function isSaleOrderInvoiceable(row: RowValueMap): boolean {
  if (!isSaleOrderConfirmed(row)) return false
  return variantTag(firstNonNullKey(row, "invoiceStatus", "invoice_status")) !== "Invoiced"
}

/**
 * The reducer appends the new move to the order's `invoice_ids`, so the last entry of the
 * canonical readback is the invoice this command produced.
 */
export function observeCreatedInvoice(orderId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const order = orders.find((row) => rowId(row) === orderId)
  const ids = firstNonNullKey(order ?? {}, "invoiceIds", "invoice_ids")
  const last = Array.isArray(ids) ? ids.at(-1) : undefined
  if (last == null) return {}
  const invoice = recordRef(invoiceWorkflow.resource, last as string | number | bigint, invoiceWorkflow.module, saleOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [invoice], next: invoice }
}

export interface CreateInvoiceFromSaleOrderInput<TParams> {
  orderId: string
  params: TParams
}

/** Form-backed: the surface collects journal/accounts, then dispatches the collected params. */
export function createInvoiceFromSaleOrderAction<TParams>(options: {
  label: string
  execute(input: CreateInvoiceFromSaleOrderInput<TParams>, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, CreateInvoiceFromSaleOrderInput<TParams>> {
  return {
    id: "sales.order.create-invoice",
    label: options.label,
    kind: "form",
    canPresent: isSaleOrderInvoiceable,
    execute: options.execute,
  }
}
