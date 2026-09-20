/**
 * The order-to-cash summary shown on a sale order: Delivery / Invoice / Payment / Outstanding.
 *
 * Every value is derived from canonical records (order lines, linked invoices) at read time, never
 * from a local workflow flag, so it converges as soon as the underlying queries refresh.
 */

import { firstNonNullKey, type RowValueMap } from "@lumiere/erp-shared/row-values"
import { isInvoiceLikeMoveType } from "../accounting/invoice-to-payment"
import { normalizedTag, rowId } from "../core/row"
import { isSaleOrderConfirmed } from "./order-to-cash"

export type DeliverySummary = "none" | "pending" | "partial" | "complete"
export type InvoiceSummary = "none" | "draft" | "posted" | "credited"
export type PaymentSummary = "none" | "unpaid" | "partial" | "paid"

export interface OrderCashSummary {
  delivery: DeliverySummary
  invoice: InvoiceSummary
  payment: PaymentSummary
  /** Balance still due on posted customer invoices. */
  outstanding: number
}

/** Amounts are floats; anything under half a cent is settled. */
const EPSILON = 0.005

type Receivable = Omit<OrderCashSummary, "delivery">

const NO_RECEIVABLE: Receivable = { invoice: "none", payment: "none", outstanding: 0 }

function num(row: RowValueMap, ...keys: string[]): number {
  const value = Number(firstNonNullKey(row, ...keys) ?? 0)
  return Number.isFinite(value) ? value : 0
}

function summarizeDelivery(order: RowValueMap, lines: readonly RowValueMap[]): DeliverySummary {
  if (!isSaleOrderConfirmed(order)) return "none"
  const stockLines = lines.filter((line) => !firstNonNullKey(line, "isService", "is_service"))
  const ordered = stockLines.reduce((sum, line) => sum + num(line, "productUomQty", "product_uom_qty"), 0)
  if (ordered <= 0) return "none"
  const delivered = stockLines.reduce((sum, line) => sum + num(line, "qtyDelivered", "qty_delivered"), 0)
  if (delivered + EPSILON >= ordered) return "complete"
  return delivered > EPSILON ? "partial" : "pending"
}

function summarizeReceivable(moves: readonly RowValueMap[]): Receivable {
  const live = moves.filter(
    (move) => isInvoiceLikeMoveType(firstNonNullKey(move, "moveType", "move_type")) && normalizedTag(move.state) !== "cancel",
  )
  const posted = (type: string) =>
    live.filter((m) => normalizedTag(firstNonNullKey(m, "moveType", "move_type")) === type && normalizedTag(m.state) === "posted")
  const invoices = live.filter((m) => normalizedTag(firstNonNullKey(m, "moveType", "move_type")) === "outinvoice")
  if (invoices.length === 0) return NO_RECEIVABLE

  const postedInvoices = posted("outinvoice")
  if (postedInvoices.length === 0) return { invoice: "draft", payment: "none", outstanding: 0 }

  const total = postedInvoices.reduce((sum, m) => sum + num(m, "amountTotal", "amount_total"), 0)
  const residual = Math.max(
    0,
    postedInvoices.reduce((sum, m) => sum + num(m, "amountResidual", "amount_residual"), 0),
  )
  const credited = posted("outrefund").reduce((sum, m) => sum + num(m, "amountTotal", "amount_total"), 0)
  const payment: PaymentSummary =
    residual <= EPSILON ? "paid" : residual < total - EPSILON ? "partial" : "unpaid"
  return {
    invoice: total > EPSILON && credited + EPSILON >= total ? "credited" : "posted",
    payment,
    outstanding: residual,
  }
}

export function summarizeOrderToCash(
  order: RowValueMap,
  related: { lines: readonly RowValueMap[]; moves: readonly RowValueMap[] },
): OrderCashSummary {
  return { delivery: summarizeDelivery(order, related.lines), ...summarizeReceivable(related.moves) }
}

function groupBy(rows: readonly RowValueMap[], ...keys: string[]): Map<string, RowValueMap[]> {
  const groups = new Map<string, RowValueMap[]>()
  for (const row of rows) {
    const key = firstNonNullKey(row, ...keys)
    if (key == null) continue
    const list = groups.get(String(key))
    if (list) list.push(row)
    else groups.set(String(key), [row])
  }
  return groups
}

/** Order rows extended with the summary as flat, table-friendly columns. */
export function withOrderCashSummary<T extends RowValueMap>(
  orders: readonly T[],
  lines: readonly RowValueMap[],
  moves: readonly RowValueMap[],
): Array<T & { deliverySummary: DeliverySummary; invoiceSummary: InvoiceSummary; paymentSummary: PaymentSummary; outstandingAmount: number }> {
  const linesByOrder = groupBy(lines, "orderId", "order_id")
  const movesByOrder = groupBy(moves, "saleOrderId", "sale_order_id")
  return orders.map((order) => {
    const id = rowId(order)
    const summary = summarizeOrderToCash(order, {
      lines: linesByOrder.get(id) ?? [],
      moves: movesByOrder.get(id) ?? [],
    })
    return {
      ...order,
      deliverySummary: summary.delivery,
      invoiceSummary: summary.invoice,
      paymentSummary: summary.payment,
      outstandingAmount: summary.outstanding,
    }
  })
}
