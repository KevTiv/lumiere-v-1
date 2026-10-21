/**
 * Sale order lines: add, edit and remove lines on a quotation. The order's state and lock decide
 * whether a change is accepted, and that lives on the parent, so the reducers are the authority.
 *
 * Every line reducer recomputes the parent order's totals, so each declares `sale-orders` too:
 * without it the order list keeps showing the old amounts until something else refreshes it.
 */

import { recordAction, type WorkflowAction, type WorkflowExecuteContext } from "../core/action"
import { singleAddedId } from "../core/effect-delta"
import { recordRef } from "../core/record-ref"
import type { WorkflowResult } from "../core/result"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"
import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"

export const saleOrderLineWorkflow = defineWorkflow({
  id: "sales.order-line",
  resource: "sale_order_line",
  module: "sales",
})

export const SALE_ORDER_LINE_AFFECTS = ["sale-order-lines", "sale-orders"] as const

/** The order-owned `order_line` relation, normalized for pre/post effect comparison. */
export function saleOrderLineIds(orderId: string, orders: readonly RowValueMap[]): string[] | undefined {
  const order = orders.find((row) => rowId(row) === orderId)
  if (!order) return undefined
  const ids = firstNonNullKey(order, "orderLine", "order_line")
  return Array.isArray(ids) ? ids.map(String) : []
}

/** `create_sale_order_line` appends the new line to the order: exactly one new id is the line. */
export function observeCreatedSaleOrderLine(
  orderId: string,
  lineIdsBefore: readonly string[],
  orders: readonly RowValueMap[],
): ObservedTransition {
  const created = singleAddedId(lineIdsBefore, saleOrderLineIds(orderId, orders))
  if (!created) return {}
  return {
    outcome: "applied",
    createdRecords: [recordRef(saleOrderLineWorkflow.resource, created, saleOrderLineWorkflow.module)],
  }
}

/** `delete_sale_order_line` removes the line row itself; its absence is the effect. */
export function observeDeletedSaleOrderLine(lineId: string, lines: readonly RowValueMap[]): ObservedTransition {
  return lines.some((row) => rowId(row) === lineId) ? {} : { outcome: "applied" }
}

export interface CreateSaleOrderLineInput<TParams> {
  orderId: string
  params: TParams
}

export interface UpdateSaleOrderLineInput<TParams> {
  lineId: string
  params: TParams
}

/** Form-backed: the surface collects the line, then dispatches it against the chosen order. */
export function createSaleOrderLineAction<TParams>(options: {
  label: string
  execute(input: CreateSaleOrderLineInput<TParams>, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, CreateSaleOrderLineInput<TParams>> {
  return {
    id: "sales.order-line.create",
    label: options.label,
    kind: "form",
    canPresent: () => true,
    execute: options.execute,
  }
}

export function updateSaleOrderLineAction<TParams>(options: {
  label: string
  execute(input: UpdateSaleOrderLineInput<TParams>, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, UpdateSaleOrderLineInput<TParams>> {
  return {
    id: "sales.order-line.update",
    label: options.label,
    kind: "form",
    canPresent: () => true,
    execute: options.execute,
  }
}

/** A line row does not carry its order's state or lock, so it is always presented; the reducer decides. */
export function deleteSaleOrderLineAction(options: {
  label: string
  execute(lineId: string, context?: WorkflowExecuteContext): Promise<WorkflowResult>
}): WorkflowAction<RowValueMap, string> {
  return recordAction("sales.order-line.delete", "destructive", () => true, options)
}
