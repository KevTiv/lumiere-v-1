import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stateName, type OrderToCashProjection, type OrderToCashScope } from "./order-to-cash"

export interface SubscriptionHandoffProjection extends OrderToCashProjection {
  readonly subscriptionId?: unknown
  readonly subscription_id?: unknown
  readonly invoiceMoveId?: unknown
  readonly invoice_move_id?: unknown
  readonly reconciledInvoiceIds?: unknown
  readonly reconciled_invoice_ids?: unknown
  readonly code?: unknown
}

export type SubscriptionHandoff = { readonly id: bigint; readonly name: string; readonly state: string }
export type SubscriptionHandoffs = {
  readonly invoices: readonly SubscriptionHandoff[]
  readonly payments: readonly SubscriptionHandoff[]
  /** A billing run names an invoice that the available projection cannot uniquely resolve. */
  readonly unavailable: boolean
}

function inScope(row: SubscriptionHandoffProjection, scope: OrderToCashScope): boolean {
  return parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
}

function ids(value: unknown): bigint[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const id = parseStrictU64(item)
    return id == null || id === 0n ? [] : [id]
  }) : []
}

/** Canonical read-only billing chain: subscription → billing run → invoice ← reconciled payment. */
export function subscriptionHandoffs(
  subscription: SubscriptionHandoffProjection,
  scope: OrderToCashScope,
  runs: readonly SubscriptionHandoffProjection[],
  moves: readonly SubscriptionHandoffProjection[],
  payments: readonly SubscriptionHandoffProjection[],
): SubscriptionHandoffs {
  const subscriptionId = parseStrictU64(subscription.id)
  if (subscriptionId == null || subscriptionId === 0n || !inScope(subscription, scope)) {
    return { invoices: [], payments: [], unavailable: true }
  }
  const invoiceIds = new Set<bigint>()
  let unavailable = false
  for (const run of runs) {
    if (!inScope(run, scope) || parseStrictU64(run.subscriptionId ?? run.subscription_id) !== subscriptionId) continue
    const invoiceId = parseStrictU64(run.invoiceMoveId ?? run.invoice_move_id)
    if (invoiceId == null || invoiceId === 0n) { unavailable = true; continue }
    invoiceIds.add(invoiceId)
  }
  const invoices: SubscriptionHandoff[] = []
  for (const id of invoiceIds) {
    const matches = moves.filter((move) => inScope(move, scope) && parseStrictU64(move.id) === id)
    const move = matches[0]
    if (matches.length !== 1 || !move || stateName(move.moveType ?? move.move_type) !== "outinvoice") {
      unavailable = true
      continue
    }
    const state = stateName(move.state)
    if (state === "cancel" || state === "cancelled") continue
    invoices.push({ id, name: String(move.name ?? ""), state })
  }
  const resolvedInvoiceIds = new Set(invoices.map((invoice) => invoice.id))
  const linkedPayments = payments.filter((payment) => inScope(payment, scope)
    && stateName(payment.state) === "paid"
    && ids(payment.reconciledInvoiceIds ?? payment.reconciled_invoice_ids).some((id) => resolvedInvoiceIds.has(id)))
  const paymentCounts = new Map<bigint, number>()
  for (const payment of linkedPayments) {
    const id = parseStrictU64(payment.id)
    if (id != null) paymentCounts.set(id, (paymentCounts.get(id) ?? 0) + 1)
  }
  const paymentLinks: SubscriptionHandoff[] = []
  for (const payment of linkedPayments) {
    const id = parseStrictU64(payment.id)
    if (id == null || id === 0n || paymentCounts.get(id) !== 1) { unavailable = true; continue }
    paymentLinks.push({ id, name: String(payment.name ?? ""), state: stateName(payment.state) })
  }
  const byId = (a: SubscriptionHandoff, b: SubscriptionHandoff) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  return { invoices: invoices.sort(byId), payments: paymentLinks.sort(byId), unavailable }
}
