import { parseStrictU64 } from "@lumiere/erp-shared/u64"

/**
 * COV-24 / COV-25: the order → delivery → invoice → collection handoffs of a sale order,
 * composed from the canonical `stock-pickings`, `account-moves`, `sale-orders` and
 * `partner-credit-holds` projections. Every relation is an exact foreign key
 * (`stock_picking.sale_id`, `account_move.sale_order_id`, `partner_id`) inside one
 * organization and company — never a name, reference or newest-row match — and nothing
 * here is stored: it is a read-only view over records the canonical operations own.
 */
export type OrderToCashScope = { readonly organizationId: bigint; readonly companyId: bigint }

type Row = Readonly<Record<string, unknown>>

export type PickingHandoff = { readonly id: bigint; readonly state: string; readonly name: string }
export type InvoiceHandoff = {
  readonly id: bigint
  readonly state: string
  readonly name: string
  readonly paymentState: string
  readonly residual: number
  readonly dueMicros: bigint | null
}
export type OrderHandoffs = {
  readonly pickings: readonly PickingHandoff[]
  readonly invoices: readonly InvoiceHandoff[]
}

export type OrderToCashException =
  | "no_delivery"
  | "delivery_incomplete"
  | "not_invoiced"
  | "collection_overdue"
  | "credit_hold"

export type OrderToCashStage = "to_deliver" | "to_invoice" | "to_collect" | "settled"

export type OrderToCashRow = {
  readonly orderId: bigint
  readonly reference: string
  readonly partnerId: bigint | null
  readonly stage: OrderToCashStage
  readonly exceptions: readonly OrderToCashException[]
  readonly handoffs: OrderHandoffs
  /** Sum of the open residual on posted invoices. */
  readonly openBalance: number
}

const EPSILON = 0.0001

/** Lower-cased state of an enum cell (`"Posted"`, `{ tag: "Posted" }`, `{ posted: [] }`) or plain string. */
export function stateName(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value && typeof value.tag === "string") return value.tag.toLowerCase()
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

function inScope(row: Row, scope: OrderToCashScope): boolean {
  return (
    parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
  )
}

/** Micros of a Timestamp / Option<Timestamp> cell or an ISO date string, else `null`. */
export function timestampMicros(value: unknown): bigint | null {
  if (value == null) return null
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if ("some" in record) return timestampMicros(record.some)
    if ("none" in record) return null
    const inner = record.__timestamp_micros_since_unix_epoch__ ?? record.microsSinceUnixEpoch
    return inner === undefined ? null : (parseStrictU64(inner) ?? null)
  }
  const numeric = parseStrictU64(value)
  if (numeric != null) return numeric
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : BigInt(parsed) * 1000n
  }
  return null
}

function byId<T extends { readonly id: bigint }>(items: T[]): T[] {
  return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The deliveries and customer invoices linked to one order by exact foreign key. Returns,
 * cancelled documents and non-invoice moves are excluded; documents are ordered by id.
 */
export function orderHandoffs(
  orderId: bigint,
  scope: OrderToCashScope,
  pickings: readonly Row[],
  moves: readonly Row[],
): OrderHandoffs {
  const deliveries: PickingHandoff[] = []
  for (const picking of pickings) {
    const id = parseStrictU64(picking.id)
    if (id == null || !inScope(picking, scope)) continue
    if (parseStrictU64(picking.saleId ?? picking.sale_id) !== orderId) continue
    if (picking.isReturn === true || picking.is_return === true) continue
    const state = stateName(picking.state)
    if (state === "cancel" || state === "cancelled") continue
    deliveries.push({ id, state, name: String(picking.name ?? "") })
  }
  const invoices: InvoiceHandoff[] = []
  for (const move of moves) {
    const id = parseStrictU64(move.id)
    if (id == null || !inScope(move, scope)) continue
    if (parseStrictU64(move.saleOrderId ?? move.sale_order_id) !== orderId) continue
    if (stateName(move.moveType ?? move.move_type) !== "outinvoice") continue
    const state = stateName(move.state)
    if (state === "cancelled" || state === "cancel") continue
    const residual = Number(move.amountResidual ?? move.amount_residual ?? 0)
    invoices.push({
      id,
      state,
      name: String(move.name ?? ""),
      paymentState: stateName(move.paymentState ?? move.payment_state),
      residual: Number.isFinite(residual) ? residual : 0,
      dueMicros: timestampMicros(move.invoiceDateDue ?? move.invoice_date_due),
    })
  }
  return { pickings: byId(deliveries), invoices: byId(invoices) }
}

function partnerOnHold(holds: readonly Row[], scope: OrderToCashScope, partnerId: bigint | null): boolean {
  if (partnerId == null) return false
  return holds.some(
    (hold) =>
      inScope(hold, scope)
      && parseStrictU64(hold.partnerId ?? hold.partner_id) === partnerId
      && (hold.paymentHold === true || hold.payment_hold === true),
  )
}

/**
 * Confirmed (`Sale`) and locked (`Done`) orders of the company with their stage and the
 * exceptions that need an operator: no delivery, an unfinished delivery, delivered but not
 * invoiced, an overdue open invoice, a customer on credit hold. Draft, quoted, awaiting
 * approval and cancelled orders are not part of order-to-cash. Ordered by order id.
 */
export function orderToCashRows(
  orders: readonly Row[],
  pickings: readonly Row[],
  moves: readonly Row[],
  holds: readonly Row[],
  scope: OrderToCashScope,
  nowMicros: bigint,
): OrderToCashRow[] {
  const rows: OrderToCashRow[] = []
  for (const order of orders) {
    const orderId = parseStrictU64(order.id)
    if (orderId == null || !inScope(order, scope)) continue
    const state = stateName(order.state)
    if (state !== "sale" && state !== "done") continue
    const partnerId = parseStrictU64(order.partnerId ?? order.partner_id) ?? null
    const handoffs = orderHandoffs(orderId, scope, pickings, moves)
    const posted = handoffs.invoices.filter((invoice) => invoice.state === "posted")
    const open = posted.filter((invoice) => invoice.residual > EPSILON)
    const delivered = handoffs.pickings.length > 0 && handoffs.pickings.every((picking) => picking.state === "done")

    const exceptions: OrderToCashException[] = []
    if (handoffs.pickings.length === 0) exceptions.push("no_delivery")
    else if (!delivered) exceptions.push("delivery_incomplete")
    if (delivered && posted.length === 0) exceptions.push("not_invoiced")
    if (open.some((invoice) => invoice.dueMicros != null && invoice.dueMicros < nowMicros)) {
      exceptions.push("collection_overdue")
    }
    if (partnerOnHold(holds, scope, partnerId)) exceptions.push("credit_hold")

    const stage: OrderToCashStage = !delivered
      ? "to_deliver"
      : posted.length === 0
        ? "to_invoice"
        : open.length > 0
          ? "to_collect"
          : "settled"
    rows.push({
      orderId,
      reference: String(order.reference ?? order.clientOrderRef ?? order.client_order_ref ?? ""),
      partnerId,
      stage,
      exceptions,
      handoffs,
      openBalance: open.reduce((sum, invoice) => sum + invoice.residual, 0),
    })
  }
  return rows.sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0))
}
