import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stateName, timestampMicros, type OrderHandoffs, type OrderToCashProjection, type OrderToCashScope } from "./order-to-cash"

export interface PurchaseHandoffProjection extends OrderToCashProjection {
  readonly purchaseId?: unknown
  readonly purchase_id?: unknown
  readonly pickingCode?: unknown
  readonly picking_code?: unknown
  readonly invoiceIds?: unknown
  readonly invoice_ids?: unknown
}

function inScope(row: PurchaseHandoffProjection, scope: OrderToCashScope): boolean {
  return parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
}

/** Read-only PO handoffs: incoming receipts by purchase_id, vendor bills by the PO-owned invoice_ids relation. */
export function purchaseOrderHandoffs(
  order: PurchaseHandoffProjection,
  scope: OrderToCashScope,
  pickings: readonly PurchaseHandoffProjection[],
  moves: readonly PurchaseHandoffProjection[],
): OrderHandoffs {
  const orderId = parseStrictU64(order.id)
  if (orderId == null || orderId === 0n || !inScope(order, scope)) return { pickings: [], invoices: [] }
  const invoiceIds = order.invoiceIds ?? order.invoice_ids
  const billIds = new Set(Array.isArray(invoiceIds) ? invoiceIds.flatMap((value) => {
    const id = parseStrictU64(value)
    return id == null ? [] : [id]
  }) : [])
  const receipts = pickings.flatMap((picking) => {
    const id = parseStrictU64(picking.id)
    const state = stateName(picking.state)
    if (id == null || !inScope(picking, scope)
      || parseStrictU64(picking.purchaseId ?? picking.purchase_id) !== orderId
      || stateName(picking.pickingCode ?? picking.picking_code) !== "incoming"
      || picking.isReturn === true || picking.is_return === true
      || state === "cancel" || state === "cancelled") return []
    return [{ id, state, name: String(picking.name ?? "") }]
  })
  const bills = moves.flatMap((move) => {
    const id = parseStrictU64(move.id)
    const state = stateName(move.state)
    if (id == null || !billIds.has(id) || !inScope(move, scope)
      || stateName(move.moveType ?? move.move_type) !== "ininvoice"
      || state === "cancel" || state === "cancelled") return []
    const residual = Number(move.amountResidual ?? move.amount_residual ?? 0)
    return [{
      id, state, name: String(move.name ?? ""),
      paymentState: stateName(move.paymentState ?? move.payment_state),
      residual: Number.isFinite(residual) ? residual : 0,
      dueMicros: timestampMicros(move.invoiceDateDue ?? move.invoice_date_due),
    }]
  })
  const byId = (a: { id: bigint }, b: { id: bigint }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  return { pickings: receipts.sort(byId), invoices: bills.sort(byId) }
}
