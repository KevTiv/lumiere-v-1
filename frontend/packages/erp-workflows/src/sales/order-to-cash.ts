import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import type { WorkflowAction, WorkflowExecuteContext } from "../core/action"
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
