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
  /** A billing run names an invoice that the available projection cannot resolve. */
  readonly unavailable: boolean
  /**
   * A canonical relation is duplicated (same invoice on two runs, two rows for one ID, a repeated
   * reconciliation ID, or two rows for one payment). Never deduplicated or resolved to first/latest:
   * invoice-side duplicates withhold every link; payment-side duplicates withhold only payments.
   */
  readonly invariantFailure: boolean
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

const invariantFailure = (): SubscriptionHandoffs =>
  ({ invoices: [], payments: [], unavailable: false, invariantFailure: true })

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
    return { invoices: [], payments: [], unavailable: true, invariantFailure: false }
  }
  const invoiceIds = new Set<bigint>()
  let unavailable = false
  for (const run of runs) {
    if (!inScope(run, scope) || parseStrictU64(run.subscriptionId ?? run.subscription_id) !== subscriptionId) continue
    const invoiceId = parseStrictU64(run.invoiceMoveId ?? run.invoice_move_id)
    if (invoiceId == null || invoiceId === 0n) { unavailable = true; continue }
    if (invoiceIds.has(invoiceId)) return invariantFailure()
    invoiceIds.add(invoiceId)
  }
  const invoices: SubscriptionHandoff[] = []
  for (const id of invoiceIds) {
    const matches = moves.filter((move) => inScope(move, scope) && parseStrictU64(move.id) === id)
    if (matches.length > 1) return invariantFailure()
    const move = matches[0]
    if (!move || stateName(move.moveType ?? move.move_type) !== "outinvoice") {
      unavailable = true
      continue
    }
    const state = stateName(move.state)
    if (state === "cancel" || state === "cancelled") continue
    invoices.push({ id, name: String(move.name ?? ""), state })
  }
  const resolvedInvoiceIds = new Set(invoices.map((invoice) => invoice.id))
  const byId = (a: SubscriptionHandoff, b: SubscriptionHandoff) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  const sortedInvoices = invoices.sort(byId)
  const linkedPayments: SubscriptionHandoffProjection[] = []
  for (const payment of payments) {
    if (!inScope(payment, scope) || stateName(payment.state) !== "paid") continue
    const reconciled = ids(payment.reconciledInvoiceIds ?? payment.reconciled_invoice_ids)
    if (!reconciled.some((id) => resolvedInvoiceIds.has(id))) continue
    if (new Set(reconciled).size !== reconciled.length) {
      return { invoices: sortedInvoices, payments: [], unavailable, invariantFailure: true }
    }
    linkedPayments.push(payment)
  }
  const paymentLinks: SubscriptionHandoff[] = []
  const seenPayments = new Set<bigint>()
  for (const payment of linkedPayments) {
    const id = parseStrictU64(payment.id)
    if (id == null || id === 0n) { unavailable = true; continue }
    if (seenPayments.has(id)) return { invoices: sortedInvoices, payments: [], unavailable, invariantFailure: true }
    seenPayments.add(id)
    paymentLinks.push({ id, name: String(payment.name ?? ""), state: stateName(payment.state) })
  }
  return { invoices: sortedInvoices, payments: paymentLinks.sort(byId), unavailable, invariantFailure: false }
}
