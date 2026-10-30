import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { purchaseOrderLinks, type CrossRecordLinks } from "@lumiere/query-hooks/hooks/cross-record-links"
import type { OrderToCashScope } from "@lumiere/query-hooks/hooks/order-to-cash"
import type { PurchaseHandoffProjection } from "@lumiere/query-hooks/hooks/purchase-order-handoffs"
import { purchaseMatchRecovery } from "./purchase-match-recovery"

export interface PurchaseDiscrepancyRow extends PurchaseHandoffProjection {
  orderId?: unknown
  order_id?: unknown
  receiptStatus?: unknown
  receipt_status?: unknown
  productQty?: unknown
  product_qty?: unknown
  qtyReceived?: unknown
  qty_received?: unknown
  qtyInvoiced?: unknown
  qty_invoiced?: unknown
  matchQtyTolerance?: unknown
  match_qty_tolerance?: unknown
}

export interface PurchaseDiscrepancy {
  id: string
  orderId: string
  label: string
  orderLabel: string
  orderHref: string
  lineHref?: string
  linesHref: string
  handoffsHref: string
  parent: PurchaseDiscrepancyRow
  ordered?: number
  received?: number
  billed?: number
}

function inScope(row: PurchaseHandoffProjection, scope: OrderToCashScope): boolean {
  return scope.organizationId > 0n && scope.companyId > 0n
    && parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
}

export function scopedPurchaseReviewRows<Row extends PurchaseDiscrepancyRow>(rows: readonly Row[], scope: OrderToCashScope): Row[] {
  return rows.filter((row) => Boolean(parseStrictU64(row.id)) && inScope(row, scope))
}
function tag(value: unknown): string {
  const text = typeof value === "string" ? value : value && typeof value === "object" && "tag" in value ? String(value.tag) : ""
  return text.toLowerCase().replaceAll("_", "")
}
function parentFor(id: bigint, orders: readonly PurchaseDiscrepancyRow[], scope: OrderToCashScope): PurchaseDiscrepancyRow | undefined {
  const matches = orders.filter((row) => parseStrictU64(row.id) === id && inScope(row, scope))
  return matches.length === 1 ? matches[0] : undefined
}
function base(parent: PurchaseDiscrepancyRow, id: bigint): Omit<PurchaseDiscrepancy, "id" | "label"> {
  const orderHref = `/purchasing/orders/${id}`
  return { orderId: String(id), orderLabel: String(parent.name ?? id), orderHref,
    linesHref: `${orderHref}?tab=lines`, handoffsHref: `${orderHref}?tab=handoffs`, parent }
}

/** Queues identify candidates; current authorized records must confirm each discrepancy. */
export function purchaseDiscrepancies(
  partialQueue: readonly PurchaseDiscrepancyRow[], overBilledQueue: readonly PurchaseDiscrepancyRow[],
  orders: readonly PurchaseDiscrepancyRow[], lines: readonly PurchaseDiscrepancyRow[], scope: OrderToCashScope,
) {
  let unresolved = 0
  const partial: PurchaseDiscrepancy[] = []
  const overBilled: PurchaseDiscrepancy[] = []
  const seenOrders = new Set<string>()
  const seenLines = new Set<string>()
  for (const candidate of partialQueue) {
    if (!inScope(candidate, scope)) continue
    const id = parseStrictU64(candidate.id)
    const parent = id ? parentFor(id, orders, scope) : undefined
    if (!id || !parent || seenOrders.has(String(id)) || tag(parent.receiptStatus ?? parent.receipt_status) !== "partial"
      || tag(parent.state) !== "purchase") { unresolved++; continue }
    seenOrders.add(String(id))
    partial.push({ ...base(parent, id), id: String(id), label: String(parent.name ?? id) })
  }
  for (const candidate of overBilledQueue) {
    if (!inScope(candidate, scope)) continue
    const id = parseStrictU64(candidate.id)
    const matches = id ? lines.filter((row) => parseStrictU64(row.id) === id && inScope(row, scope)) : []
    const line = matches.length === 1 ? matches[0] : undefined
    const orderId = line && parseStrictU64(line.orderId ?? line.order_id)
    const parent = orderId ? parentFor(orderId, orders, scope) : undefined
    if (!id || !line || !orderId || !parent || seenLines.has(String(id)) || tag(parent.state) !== "purchase"
      || !["draft", "confirmed"].includes(tag(line.state))) { unresolved++; continue }
    const quantities = { productQty: line.productQty ?? line.product_qty, qtyReceived: line.qtyReceived ?? line.qty_received,
      qtyInvoiced: line.qtyInvoiced ?? line.qty_invoiced, orderId: String(orderId), state: line.state }
    const match = purchaseMatchRecovery(quantities, { id: String(orderId), state: parent.state,
      matchQtyTolerance: parent.matchQtyTolerance ?? parent.match_qty_tolerance })
    if (match.status !== "over_billed") { unresolved++; continue }
    seenLines.add(String(id))
    overBilled.push({ ...base(parent, orderId), id: String(id), label: String(line.name ?? id),
      lineHref: moduleTabHref("purchasing", "lines", { id: String(id) }),
      ordered: Number(quantities.productQty), received: Number(quantities.qtyReceived), billed: Number(quantities.qtyInvoiced) })
  }
  return { partial, overBilled, unresolved }
}

/** These links are explicitly order-level; line quantity totals never infer a bill or receipt. */
export function purchaseDiscrepancyHandoffs(parent: PurchaseDiscrepancyRow, scope: OrderToCashScope,
  pickings: readonly PurchaseHandoffProjection[], moves: readonly PurchaseHandoffProjection[]): CrossRecordLinks {
  const id = parseStrictU64(parent.id)
  if (!id || !inScope(parent, scope)) return { status: "unavailable", links: [], reason: "Purchase order is outside the current scope" }
  const related = pickings.filter((row) => inScope(row, scope) && parseStrictU64(row.purchaseId ?? row.purchase_id) === id)
  if (related.some((row) => !["incoming", "outgoing", "internal"].includes(tag(row.pickingCode ?? row.picking_code)))) {
    return { status: "unavailable", links: [], reason: "The receipt type could not be verified" }
  }
  const incoming = related.filter((row) => tag(row.pickingCode ?? row.picking_code) === "incoming")
  const bills = moves.filter((row) => tag(row.moveType ?? row.move_type) === "ininvoice")
  return purchaseOrderLinks(parent, scope, incoming, bills)
}
