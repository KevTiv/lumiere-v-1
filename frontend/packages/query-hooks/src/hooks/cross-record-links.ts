import { accountMoveHref, saleOrderHref, stockPickingHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stateName, type OrderToCashScope } from "./order-to-cash"

/** A wire ID or relation as received: always parsed strictly, never trusted as typed. */
type Raw = unknown
/** Fields every linked record is read through, in both projection spellings. */
interface ScopedRow {
  readonly id?: Raw
  readonly organizationId?: Raw
  readonly organization_id?: Raw
  readonly companyId?: Raw
  readonly company_id?: Raw
  readonly name?: Raw
  readonly reference?: Raw
}
interface PurchaseOrderRow extends ScopedRow {
  readonly invoiceIds?: Raw
  readonly invoice_ids?: Raw
}
interface PickingRow extends ScopedRow {
  readonly purchaseId?: Raw
  readonly purchase_id?: Raw
  readonly isReturn?: Raw
  readonly is_return?: Raw
  readonly state?: Raw
}
interface ProposalRow extends ScopedRow {
  readonly saleOrderId?: Raw
  readonly sale_order_id?: Raw
}
export type CrossRecordLink = { id: string; kind: "receipt" | "bill" | "invoice" | "payment" | "order"; href: string; label: string }
export type CrossRecordLinks =
  | { status: "ready"; links: CrossRecordLink[]; paymentNotice?: { status: "unavailable" | "invariant_failure"; reason: string } }
  | { status: "unavailable" | "invariant_failure"; links: []; reason: string }

const scoped = (row: ScopedRow, scope: OrderToCashScope) =>
  parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId &&
  parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
const unavailable = (reason: string): CrossRecordLinks => ({ status: "unavailable", links: [], reason })
const invariant = (reason: string): CrossRecordLinks => ({ status: "invariant_failure", links: [], reason })

function ids(value: unknown): bigint[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed = value.map(parseStrictU64)
  return parsed.every((id): id is bigint => id != null) ? parsed : undefined
}

/** Exact parent-owned IDs, never position, document name, partner or date correlation. */
function targets(
  references: readonly bigint[], rows: readonly ScopedRow[], scope: OrderToCashScope,
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
export function purchaseOrderLinks(parent: PurchaseOrderRow, scope: OrderToCashScope, pickings: readonly PickingRow[], moves: readonly ScopedRow[]): CrossRecordLinks {
  const id = parseStrictU64(parent.id)
  if (id == null || !scoped(parent, scope)) return unavailable("Purchase order is outside the current scope")
  const billIds = ids(parent.invoiceIds ?? parent.invoice_ids)
  if (billIds == null) return unavailable("Purchase order invoice relation is unavailable")
  const receipts = pickings.filter((row) =>
    scoped(row, scope) && parseStrictU64(row.purchaseId ?? row.purchase_id) === id &&
    (row.isReturn ?? row.is_return) !== true && !["cancel", "cancelled"].includes(stateName(row.state)),
  )
  const receiptIds = ids(receipts.map((row) => row.id))
  if (receiptIds == null) return invariant("Receipt has no canonical ID")
  const receiptLinks = targets(receiptIds, receipts, scope, "receipt", stockPickingHref)
  if (receiptLinks.status !== "ready") return receiptLinks
  const billLinks = targets(billIds, moves, scope, "bill", accountMoveHref)
  return billLinks.status === "ready" ? { status: "ready", links: [...receiptLinks.links, ...billLinks.links] } : billLinks
}

/** A proposal owns at most one sale order. A missing referenced target is not “none”. */
export function proposalOrderLinks(parent: ProposalRow, scope: OrderToCashScope, orders: readonly ScopedRow[]): CrossRecordLinks {
  if (!scoped(parent, scope)) return unavailable("Proposal is outside the current scope")
  if (!("saleOrderId" in parent) && !("sale_order_id" in parent)) return unavailable("Proposal sale order relation is unavailable")
  const raw = parent.saleOrderId ?? parent.sale_order_id
  const id = parseStrictU64(raw)
  if (id == null) {
    if (raw == null || (typeof raw === "object" && "none" in raw)) return { status: "ready", links: [] }
    return invariant("Invalid proposal sale order relation")
  }
  return targets([id], orders, scope, "order", saleOrderHref)
}
