/**
 * Procure-to-pay: requisition / RFQ → purchase order → receipt → vendor bill. Payment reuses the
 * accounting invoice/payment workflow (a vendor bill is an `account_move`).
 *
 * Presentation gates only; the reducers re-validate state, permission, approval and quantities
 * (mirrors `purchase_orders.rs` / `sourcing.rs`).
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import { recordAction, type ExecuteAction, type WorkflowAction } from "../core/action"
import { recordRef } from "../core/record-ref"
import { rowId, variantTag } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"
import { invoiceWorkflow } from "../accounting/invoice-to-payment"
import { pickingWorkflow } from "../inventory/fulfillment"

export const purchaseRequisitionWorkflow = defineWorkflow({
  id: "purchasing.requisition",
  resource: "purchase_requisition",
  module: "purchasing",
})

export const purchaseOrderWorkflow = defineWorkflow({
  id: "purchasing.order",
  resource: "purchase_order",
  module: "purchasing",
})

export const REQUISITION_TRANSITION_AFFECTS = ["purchase-requisitions"] as const
export const CONVERT_REQUISITION_AFFECTS = [
  "purchase-requisitions",
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-order-lines",
] as const
export const AWARD_RFQ_BID_AFFECTS = [
  "purchase-rfqs",
  "purchase-rfq-bids",
  "purchase-orders",
  "purchase-order-lines",
] as const
export const SEND_PURCHASE_ORDER_AFFECTS = ["purchase-orders", "purchase-orders-to-approve"] as const
/** Confirming spawns the inbound receipt picking and its moves. */
export const CONFIRM_PURCHASE_ORDER_AFFECTS = [
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-order-lines",
  "stock-pickings",
  "stock-moves",
] as const
export const CANCEL_PURCHASE_ORDER_AFFECTS = ["purchase-orders", "purchase-orders-to-approve"] as const
/** Receiving validates the receipt picking: stock, the line's received quantity and the PO's receipt/match state move. */
export const RECEIVE_PO_LINE_AFFECTS = [
  "purchase-orders",
  "purchase-orders-partial-receipt",
  "purchase-order-lines",
  "purchase-order-lines-over-billed",
  "stock-pickings",
  "stock-moves",
  "stock-quants",
] as const
/** The bill is a draft `account_move`; it also moves the PO's invoiced quantities and match state. */
export const CREATE_BILL_FROM_PURCHASE_ORDER_AFFECTS = [
  "purchase-orders",
  "purchase-order-lines",
  "purchase-order-lines-over-billed",
  "account-moves",
  "account-move-lines",
] as const

/** Presentation state: enum tags (`Draft`, `{tag}`) compare by variant name. */
function stateOf(row: RowValueMap): string {
  return variantTag(firstNonNullKey(row, "state"))
}

const isOneOf = (row: RowValueMap, ...states: string[]) => states.includes(stateOf(row))

// ── Requisition: Draft → InProgress → Approved → (PO), Closed/Cancelled terminal ──

export const isRequisitionSubmittable = (row: RowValueMap) => isOneOf(row, "Draft")
export const isRequisitionApprovable = (row: RowValueMap) => isOneOf(row, "InProgress")
export const isRequisitionConvertible = (row: RowValueMap) => isOneOf(row, "Approved")
export const isRequisitionClosable = (row: RowValueMap) => !isOneOf(row, "Closed", "Cancelled")
export const isRequisitionCancellable = isRequisitionClosable

// ── Purchase order: Draft → Sent → Purchase (confirmed) → Done, Cancelled terminal ──

export const isPurchaseOrderSendable = (row: RowValueMap) => isOneOf(row, "Draft")
export const isPurchaseOrderConfirmable = (row: RowValueMap) => isOneOf(row, "Draft", "Sent", "ToApprove")
export const isPurchaseOrderCancellable = (row: RowValueMap) => !isOneOf(row, "Done", "Cancelled")
export const isPurchaseOrderConfirmed = (row: RowValueMap) => isOneOf(row, "Purchase", "Done")

/**
 * A confirmed order that is not fully billed. Whether anything received is still unbilled is
 * decided by the reducer from line quantities.
 */
export function isPurchaseOrderBillable(row: RowValueMap): boolean {
  if (!isPurchaseOrderConfirmed(row)) return false
  return variantTag(firstNonNullKey(row, "invoiceStatus", "invoice_status")) !== "Invoiced"
}

/** Quantity still open to receive on a purchase order line. */
export function purchaseLineOpenQty(row: RowValueMap): number {
  const ordered = Number(firstNonNullKey(row, "productQty", "product_qty") ?? 0)
  const received = Number(firstNonNullKey(row, "qtyReceived", "qty_received") ?? 0)
  return Math.max(0, ordered - received)
}

export const isPurchaseLineReceivable = (row: RowValueMap) => purchaseLineOpenQty(row) > 0

/** RFQ bids are awarded only while `submitted`; the RFQ itself must not be awarded/cancelled. */
export const isRfqBidAwardable = (row: RowValueMap) => String(firstNonNullKey(row, "state") ?? "") === "submitted"

// ── Readback ────────────────────────────────────────────────────────────────────

function idList(row: RowValueMap, ...keys: string[]): string[] {
  const value = firstNonNullKey(row, ...keys)
  return Array.isArray(value) ? value.map((id) => String(id)) : []
}

const findRow = (rows: readonly RowValueMap[], id: string) => rows.find((row) => rowId(row) === id)

const orderRef = (id: string | number | bigint, context?: string) =>
  recordRef(purchaseOrderWorkflow.resource, id, purchaseOrderWorkflow.module, context)

/** Sending goes through the approval gate: an order still in Draft was handed to an approval task. */
export function observeSentPurchaseOrder(orderId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const order = findRow(orders, orderId)
  if (!order) return {}
  return isPurchaseOrderSendable(order)
    ? { outcome: "approval_pending", next: orderRef(orderId) }
    : { outcome: "applied" }
}

/**
 * `confirm_purchase_order` returns success without changing state when it hands the order to an
 * approval task. A confirmed order links the receipt pickings it spawned; the user stays on the
 * order, where receiving and billing continue.
 */
export function observeConfirmedPurchaseOrder(orderId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const order = findRow(orders, orderId)
  if (!order) return {}
  if (!isPurchaseOrderConfirmed(order)) return { outcome: "approval_pending", next: orderRef(orderId) }
  const receipts = idList(order, "pickingIds", "picking_ids").map((id) =>
    recordRef(pickingWorkflow.resource, id, pickingWorkflow.module, purchaseOrderWorkflow.module),
  )
  return {
    outcome: "applied",
    createdRecords: receipts.length > 0 ? receipts : undefined,
    next: orderRef(orderId),
  }
}

/** The reducer appends each new PO to the requisition's `purchase_ids`, so the last is the one just created. */
export function observeConvertedRequisition(
  requisitionId: string,
  requisitions: readonly RowValueMap[],
): ObservedTransition {
  const last = idList(findRow(requisitions, requisitionId) ?? {}, "purchaseIds", "purchase_ids").at(-1)
  if (!last) return {}
  const order = orderRef(last)
  return { outcome: "applied", createdRecords: [order], next: order }
}

/** The RFQ an awarded PO came from: `award_purchase_rfq_bid` stamps `metadata.rfq_id`. */
export function poSourceRfqId(order: RowValueMap): string | undefined {
  const metadata = firstNonNullKey(order, "metadata")
  if (typeof metadata !== "string") return undefined
  try {
    const id = (JSON.parse(metadata) as { rfq_id?: unknown }).rfq_id
    return id == null ? undefined : String(id)
  } catch {
    return undefined
  }
}

/** The newest PO stamped with this RFQ is the one the award just created. */
export function observeAwardedRfq(rfqId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const created = orders
    .filter((row) => poSourceRfqId(row) === rfqId)
    .map(rowId)
    .sort((a, b) => Number(a) - Number(b))
    .at(-1)
  if (!created) return {}
  const order = orderRef(created)
  return { outcome: "applied", createdRecords: [order], next: order }
}

/** The reducer appends the new bill to the PO's `invoice_ids`: the last entry is the bill this command produced. */
export function observeCreatedBill(orderId: string, orders: readonly RowValueMap[]): ObservedTransition {
  const last = idList(findRow(orders, orderId) ?? {}, "invoiceIds", "invoice_ids").at(-1)
  if (!last) return {}
  const bill = recordRef(invoiceWorkflow.resource, last, invoiceWorkflow.module, purchaseOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [bill], next: bill }
}

/**
 * Receiving validates a receipt picking through its move: the newest done move for the line
 * names the receipt that was just validated. Non-stock (service) lines have no move and stay put.
 */
export function observeReceivedLine(lineId: string, moves: readonly RowValueMap[]): ObservedTransition {
  const picking = moves
    .filter((move) => {
      const line = firstNonNullKey(move, "purchaseLineId", "purchase_line_id")
      const done = Boolean(firstNonNullKey(move, "isDone", "is_done")) || String(firstNonNullKey(move, "state") ?? "") === "done"
      return line != null && String(line) === lineId && done && firstNonNullKey(move, "pickingId", "picking_id") != null
    })
    .map((move) => String(firstNonNullKey(move, "pickingId", "picking_id")))
    .sort((a, b) => Number(a) - Number(b))
    .at(-1)
  if (!picking) return { outcome: "applied" }
  const receipt = recordRef(pickingWorkflow.resource, picking, pickingWorkflow.module, purchaseOrderWorkflow.module)
  return { outcome: "applied", createdRecords: [receipt], next: receipt }
}

// ── Actions ─────────────────────────────────────────────────────────────────────

type RecordActionOptions = { label: string; execute: ExecuteAction<string> }

export const submitRequisitionAction = (o: RecordActionOptions) =>
  recordAction("purchasing.requisition.submit", "immediate", isRequisitionSubmittable, o)
export const approveRequisitionAction = (o: RecordActionOptions) =>
  recordAction("purchasing.requisition.approve", "immediate", isRequisitionApprovable, o)
export const convertRequisitionAction = (o: RecordActionOptions) =>
  recordAction("purchasing.requisition.convert", "immediate", isRequisitionConvertible, o)
export const closeRequisitionAction = (o: RecordActionOptions) =>
  recordAction("purchasing.requisition.close", "confirm", isRequisitionClosable, o)
export const cancelRequisitionAction = (o: RecordActionOptions) =>
  recordAction("purchasing.requisition.cancel", "destructive", isRequisitionCancellable, o)

export const sendPurchaseOrderAction = (o: RecordActionOptions) =>
  recordAction("purchasing.order.send", "immediate", isPurchaseOrderSendable, o)
export const confirmPurchaseOrderAction = (o: RecordActionOptions) =>
  recordAction("purchasing.order.confirm", "immediate", isPurchaseOrderConfirmable, o)
export const cancelPurchaseOrderAction = (o: RecordActionOptions) =>
  recordAction("purchasing.order.cancel", "destructive", isPurchaseOrderCancellable, o)

export interface ReceivePurchaseLineInput {
  lineId: string
  qty: number
  lotId?: string | null
}

/**
 * Receive against a purchase order line. Dispatched from a row it receives the full open
 * quantity; the receive form dispatches its own collected quantity/lot through the same `execute`.
 */
export function receivePurchaseLineAction(options: {
  label: string
  execute: ExecuteAction<ReceivePurchaseLineInput>
}): WorkflowAction<RowValueMap, ReceivePurchaseLineInput> {
  return {
    id: "purchasing.line.receive",
    label: options.label,
    kind: "immediate",
    canPresent: isPurchaseLineReceivable,
    prepare: (row) => ({ lineId: rowId(row), qty: purchaseLineOpenQty(row) }),
    execute: options.execute,
  }
}

export interface CreateBillFromPurchaseOrderInput<TParams> {
  orderId: string
  params: TParams
}

/** Form-backed: the surface collects journal/accounts, then dispatches the collected params. */
export function createBillFromPurchaseOrderAction<TParams>(options: {
  label: string
  execute: ExecuteAction<CreateBillFromPurchaseOrderInput<TParams>>
}): WorkflowAction<RowValueMap, CreateBillFromPurchaseOrderInput<TParams>> {
  return {
    id: "purchasing.order.create-bill",
    label: options.label,
    kind: "form",
    canPresent: isPurchaseOrderBillable,
    execute: options.execute,
  }
}

export interface AwardRfqBidInput {
  rfqId: string
  bidId: string
}

/** Presented against an RFQ bid row; the current prompt-driven flow dispatches the collected ids through `execute`. */
export function awardRfqBidAction(options: {
  label: string
  execute: ExecuteAction<AwardRfqBidInput>
}): WorkflowAction<RowValueMap, AwardRfqBidInput> {
  return {
    id: "purchasing.rfq.award",
    label: options.label,
    kind: "confirm",
    canPresent: isRfqBidAwardable,
    prepare: (row) => ({
      rfqId: String(firstNonNullKey(row, "rfqId", "rfq_id") ?? ""),
      bidId: rowId(row),
    }),
    execute: options.execute,
  }
}
