import { accountMoveHref, accountPaymentHref, saleOrderHref, stockPickingHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stateName, type OrderToCashScope } from "./order-to-cash"

type Row = Readonly<Record<string, unknown>>
export type CrossRecordLink = { id: string; kind: "receipt" | "bill" | "invoice" | "payment" | "order"; href: string; label: string }
export type CrossRecordLinks =
  | { status: "ready"; links: CrossRecordLink[]; paymentNotice?: { status: "unavailable" | "invariant_failure"; reason: string } }
  | { status: "unavailable" | "invariant_failure"; links: []; reason: string }

const field = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake]
const scoped = (row: Row, scope: OrderToCashScope) =>
  parseStrictU64(field(row, "organizationId", "organization_id")) === scope.organizationId &&
  parseStrictU64(field(row, "companyId", "company_id")) === scope.companyId
const unavailable = (reason: string): CrossRecordLinks => ({ status: "unavailable", links: [], reason })
const invariant = (reason: string): CrossRecordLinks => ({ status: "invariant_failure", links: [], reason })

function ids(value: unknown): bigint[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed = value.map(parseStrictU64)
  return parsed.every((id): id is bigint => id != null) ? parsed : undefined
}

/** Exact parent-owned IDs, never position, document name, partner or date correlation. */
function targets(
  references: readonly bigint[], rows: readonly Row[], scope: OrderToCashScope,
  kind: CrossRecordLink["kind"], href: (id: bigint) => string,
): CrossRecordLinks {
  if (new Set(references.map(String)).size !== references.length) return invariant("Duplicate canonical relation IDs")
  const links: CrossRecordLink[] = []
  for (const id of references) {
    const matches = rows.filter((row) => parseStrictU64(row.id) === id && scoped(row, scope))
    if (matches.length > 1) return invariant(`Multiple canonical records for ${kind} #${id}`)
    if (matches.length === 0) return unavailable(`Canonical ${kind} #${id} is not available in this scope`)
    const row = matches[0]!
    links.push({ id: String(id), kind, href: href(id), label: String(row.name ?? row.reference ?? `${kind} #${id}`) })
  }
  return { status: "ready", links }
}

/** Receipt cardinality is 0..N (including backorders); every exact child is linked. */
export function purchaseOrderLinks(parent: Row, scope: OrderToCashScope, pickings: readonly Row[], moves: readonly Row[]): CrossRecordLinks {
  const id = parseStrictU64(parent.id)
  if (id == null || !scoped(parent, scope)) return unavailable("Purchase order is outside the current scope")
  const billIds = ids(field(parent, "invoiceIds", "invoice_ids"))
  if (billIds == null) return unavailable("Purchase order invoice relation is unavailable")
  const receipts = pickings.filter((row) =>
    scoped(row, scope) && parseStrictU64(field(row, "purchaseId", "purchase_id")) === id &&
    field(row, "isReturn", "is_return") !== true && !["cancel", "cancelled"].includes(stateName(row.state)),
  )
  const receiptIds = ids(receipts.map((row) => row.id))
  if (receiptIds == null) return invariant("Receipt has no canonical ID")
  const receiptLinks = targets(receiptIds, receipts, scope, "receipt", stockPickingHref)
  if (receiptLinks.status !== "ready") return receiptLinks
  const billLinks = targets(billIds, moves, scope, "bill", accountMoveHref)
  return billLinks.status === "ready" ? { status: "ready", links: [...receiptLinks.links, ...billLinks.links] } : billLinks
}

/** A proposal owns at most one sale order. A missing referenced target is not “none”. */
export function proposalOrderLinks(parent: Row, scope: OrderToCashScope, orders: readonly Row[]): CrossRecordLinks {
  if (!scoped(parent, scope)) return unavailable("Proposal is outside the current scope")
  if (!("saleOrderId" in parent) && !("sale_order_id" in parent)) return unavailable("Proposal sale order relation is unavailable")
  const raw = field(parent, "saleOrderId", "sale_order_id")
  const id = parseStrictU64(raw)
  if (id == null) {
    if (raw == null || (typeof raw === "object" && "none" in raw)) return { status: "ready", links: [] }
    return invariant("Invalid proposal sale order relation")
  }
  return targets([id], orders, scope, "order", saleOrderHref)
}

/** Billing runs expose the exact invoice relation; subscriptions' default projection does not. */
export function subscriptionRecordLinks(parent: Row, scope: OrderToCashScope, runs: readonly Row[], moves: readonly Row[], payments: readonly Row[] | undefined): CrossRecordLinks {
  if (!scoped(parent, scope)) return unavailable("Subscription is outside the current scope")
  const subscriptionId = parseStrictU64(parent.id)
  if (subscriptionId == null) return invariant("Subscription has no canonical ID")
  const relatedRuns = runs.filter((run) => scoped(run, scope) &&
    parseStrictU64(field(run, "subscriptionId", "subscription_id")) === subscriptionId)
  const invoiceIds = ids(relatedRuns.map((run) => field(run, "invoiceMoveId", "invoice_move_id")))
  if (invoiceIds == null) return unavailable("Billing run invoice relation is unavailable")
  const invoices = targets(invoiceIds, moves, scope, "invoice", accountMoveHref)
  if (invoices.status !== "ready") return invoices
  const paymentUnavailable = (reason: string): CrossRecordLinks => ({
    ...invoices, paymentNotice: { status: "unavailable", reason },
  })
  if (payments == null) return paymentUnavailable("Payment records are unavailable")
  const relatedPayments: Row[] = []
  for (const row of payments.filter((row) => scoped(row, scope))) {
    const reconciled = ids(field(row, "reconciledInvoiceIds", "reconciled_invoice_ids"))
    if (reconciled == null) return paymentUnavailable("Payment invoice relation is unavailable")
    if (new Set(reconciled.map(String)).size !== reconciled.length) {
      return { ...invoices, paymentNotice: { status: "invariant_failure", reason: "Duplicate payment invoice relation IDs" } }
    }
    if (reconciled.some((id) => invoiceIds.includes(id))) relatedPayments.push(row)
  }
  const paymentIds = ids(relatedPayments.map((row) => row.id))
  const paymentLinks = paymentIds == null
    ? invariant("Payment has no canonical ID")
    : targets(paymentIds, relatedPayments, scope, "payment", accountPaymentHref)
  return paymentLinks.status === "ready"
    ? { status: "ready", links: [...invoices.links, ...paymentLinks.links] }
    : { ...invoices, paymentNotice: { status: paymentLinks.status, reason: paymentLinks.reason } }
}
