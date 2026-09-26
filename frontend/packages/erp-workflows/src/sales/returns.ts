/**
 * Return order (RMA) lifecycle: draft → confirmed (return picking) → received (picking done) →
 * refunded (credit note), with an optional exchange order from a confirmed/received return.
 *
 * Presentation gates only; the reducers re-validate state and lines (mirrors `return_orders.rs`).
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import type { WorkflowAction, WorkflowExecuteContext } from "../core/action"
import { recordRef } from "../core/record-ref"
import type { WorkflowResult } from "../core/result"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"
import { invoiceWorkflow } from "../accounting/invoice-to-payment"
import { pickingWorkflow } from "../inventory/fulfillment"
import { isSaleOrderConfirmed, saleOrderWorkflow } from "./order-to-cash"

export const returnOrderWorkflow = defineWorkflow({
  id: "sales.return",
  resource: "return_order",
  module: "sales",
})

/** `create_return_order` inserts the return and its lines; it does not touch stock or the order. */
export const CREATE_RETURN_ORDER_AFFECTS = ["return-orders", "return-order-lines"] as const
export const CONFIRM_RETURN_AFFECTS = ["return-orders", "return-order-lines", "stock-pickings", "stock-moves"] as const
export const CANCEL_RETURN_AFFECTS = ["return-orders", "stock-pickings", "stock-moves"] as const
/** Receiving validates the return picking: stock, the return, and the order's returned/invoiceable quantities move. */
export const RECEIVE_RETURN_AFFECTS = [
  "return-orders",
  "stock-pickings",
  "stock-moves",
  "stock-quants",
  "sale-orders",
  "sale-order-lines",
] as const
export const CREDIT_NOTE_FROM_RETURN_AFFECTS = ["return-orders", "account-moves", "account-move-lines", "sale-orders"] as const
export const EXCHANGE_FROM_RETURN_AFFECTS = ["return-orders", "sale-orders", "sale-order-lines"] as const

/** Return order states are plain lowercase strings (not enums). */
export function returnOrderState(row: RowValueMap): string {
  return String(firstNonNullKey(row, "state") ?? "").toLowerCase()
}

function hasValue(row: RowValueMap, ...keys: string[]): boolean {
  return firstNonNullKey(row, ...keys) != null
}

export const isReturnConfirmable = (row: RowValueMap) => returnOrderState(row) === "draft"

/** Receiving completes the return picking, which exists once the return is confirmed. */
export const isReturnReceivable = (row: RowValueMap) =>
  returnOrderState(row) === "confirmed" && hasValue(row, "pickingId", "picking_id")

export const isReturnCreditable = (row: RowValueMap) =>
  returnOrderState(row) === "received" && !hasValue(row, "creditMoveId", "credit_move_id")

export const isReturnExchangeable = (row: RowValueMap) => ["confirmed", "received"].includes(returnOrderState(row))

export const isReturnCancellable = (row: RowValueMap) => ["draft", "confirmed"].includes(returnOrderState(row))

/** Where a receive run starts: the picking the return created on confirm. */
export function returnPickingId(row: RowValueMap): string | undefined {
  const id = firstNonNullKey(row, "pickingId", "picking_id")
  return id == null ? undefined : String(id)
}

/**
 * The newest return created for the sale order is the one just produced (the same convention as
 * the exchange order). A return without a sale order cannot be told apart from others, so it
 * claims nothing and the surface stays where it is.
 */
export function observeCreatedReturnOrder(
  saleOrderId: string | undefined,
  returns: readonly RowValueMap[],
): ObservedTransition {
  if (saleOrderId == null) return {}
  const created = returns
    .filter((row) => String(firstNonNullKey(row, "saleOrderId", "sale_order_id") ?? "") === saleOrderId)
    .map(rowId)
    .sort((a, b) => Number(a) - Number(b))
    .at(-1)
  if (!created) return {}
  const ref = recordRef(returnOrderWorkflow.resource, created, returnOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

/** A confirmed return produces its return picking; stay on the return, where receiving is the next step. */
export function observeConfirmedReturn(returnId: string, returns: readonly RowValueMap[]): ObservedTransition {
  const picking = returnPickingId(returns.find((row) => rowId(row) === returnId) ?? {})
  if (!picking) return {}
  return {
    outcome: "applied",
    createdRecords: [recordRef(pickingWorkflow.resource, picking, pickingWorkflow.module, returnOrderWorkflow.module)],
  }
}

/** The credit note is a draft invoice-like move: open it in Accounting, where it is posted. */
export function observeReturnCreditNote(returnId: string, returns: readonly RowValueMap[]): ObservedTransition {
  const move = firstNonNullKey(returns.find((row) => rowId(row) === returnId) ?? {}, "creditMoveId", "credit_move_id")
  if (move == null) return {}
  const ref = recordRef(invoiceWorkflow.resource, move as string | number | bigint, invoiceWorkflow.module, returnOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

const EXCHANGE_ORIGIN = /^exchange:RMA\/(\d+)$/

/**
 * The return an exchange order was created from. `create_exchange_order_from_return` stamps the
 * order twice: `metadata.exchange_return_id` (structured, preferred) and `origin` (`exchange:RMA/<id>`).
 * Either identifies it, so a change to one stamp does not lose the link. (`origin_so_id` is the
 * original sale order, not the return.)
 */
export function exchangeSourceReturnId(order: RowValueMap): string | undefined {
  const metadata = firstNonNullKey(order, "metadata")
  if (typeof metadata === "string") {
    try {
      const id = (JSON.parse(metadata) as { exchange_return_id?: unknown }).exchange_return_id
      if (id != null) return String(id)
    } catch {
      // Not JSON: fall through to the origin stamp.
    }
  }
  const origin = firstNonNullKey(order, "origin")
  return typeof origin === "string" ? EXCHANGE_ORIGIN.exec(origin)?.[1] : undefined
}

/** The newest exchange order created from this return is the one just produced. */
export function observeExchangeOrder(returnId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const created = orders
    .filter((row) => exchangeSourceReturnId(row) === returnId)
    .map(rowId)
    .sort((a, b) => Number(a) - Number(b))
    .at(-1)
  if (!created) return {}
  const ref = recordRef(saleOrderWorkflow.resource, created, saleOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [ref], next: ref }
}

type Execute<TInput> = (input: TInput, context?: WorkflowExecuteContext) => Promise<WorkflowResult>

function returnAction(
  id: string,
  kind: WorkflowAction<RowValueMap, string>["kind"],
  canPresent: (row: RowValueMap) => boolean,
  options: { label: string; execute: Execute<string> },
): WorkflowAction<RowValueMap, string> {
  return { id: `sales.return.${id}`, label: options.label, kind, canPresent, prepare: rowId, execute: options.execute }
}

export const confirmReturnAction = (o: { label: string; execute: Execute<string> }) =>
  returnAction("confirm", "immediate", isReturnConfirmable, o)
/** Input is the return picking's id: receiving completes that picking. */
export const receiveReturnAction = (o: { label: string; execute: Execute<string> }): WorkflowAction<RowValueMap, string> => ({
  id: "sales.return.receive",
  label: o.label,
  kind: "immediate",
  canPresent: isReturnReceivable,
  prepare: (row) => returnPickingId(row) ?? "",
  execute: o.execute,
})
export const exchangeReturnAction = (o: { label: string; execute: Execute<string> }) =>
  returnAction("exchange", "immediate", isReturnExchangeable, o)
export const cancelReturnAction = (o: { label: string; execute: Execute<string> }) =>
  returnAction("cancel", "destructive", isReturnCancellable, o)

export interface CreateReturnOrderInput<TParams> {
  /** The order being returned; absent for a return raised without one. */
  saleOrderId?: string
  params: TParams
}

/** Form-backed: the surface collects the customer, reason and lines, then dispatches them. */
export function createReturnOrderAction<TParams>(options: {
  label: string
  execute: Execute<CreateReturnOrderInput<TParams>>
}): WorkflowAction<RowValueMap, CreateReturnOrderInput<TParams>> {
  return {
    id: "sales.return.create",
    label: options.label,
    kind: "form",
    // Offered against a delivered order; a return may also be raised from the returns tab.
    canPresent: isSaleOrderConfirmed,
    execute: options.execute,
  }
}

export interface CreateReturnCreditNoteInput<TParams> {
  returnOrderId: string
  params: TParams
}

/** Form-backed: the surface collects journal/accounts, then dispatches the collected params. */
export function createReturnCreditNoteAction<TParams>(options: {
  label: string
  execute: Execute<CreateReturnCreditNoteInput<TParams>>
}): WorkflowAction<RowValueMap, CreateReturnCreditNoteInput<TParams>> {
  return {
    id: "sales.return.create-credit-note",
    label: options.label,
    kind: "form",
    canPresent: isReturnCreditable,
    execute: options.execute,
  }
}
