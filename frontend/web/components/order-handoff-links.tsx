"use client"

import Link from "next/link"

import { buildModuleTabHref } from "@lumiere/ui"
import type { OrderHandoffs } from "@lumiere/query-hooks/hooks/order-to-cash"

/** Canonical deep links: the owning module's tab focused on exactly one record by id. */
export const orderHref = (orderId: bigint) => buildModuleTabHref("sales", "orders", { id: orderId.toString() })
export const pickingHref = (pickingId: bigint) => buildModuleTabHref("inventory", "transfers", { id: pickingId.toString() })
// The Accounting "invoices" tab is a custom list that ignores `filter=`; "journal-entries" applies the
// `id` filter (GeneralLedgerView) over every move, invoices included.
export const invoiceHref = (invoiceId: bigint) => buildModuleTabHref("accounting", "journal-entries", { id: invoiceId.toString() })

/**
 * COV-25: the deliveries and customer invoices an order generated, each linking straight to
 * its record so an operator never searches another module for them. `testIdPrefix` keeps
 * each surface's links addressable (`{prefix}-picking-{id}`, `{prefix}-invoice-{id}`).
 */
export function OrderHandoffLinks({ handoffs, testIdPrefix }: { handoffs: OrderHandoffs; testIdPrefix: string }) {
  if (handoffs.pickings.length === 0 && handoffs.invoices.length === 0) {
    return <span className="text-muted-foreground" data-testid={`${testIdPrefix}-none`}>No deliveries or invoices yet</span>
  }
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid={`${testIdPrefix}-list`}>
      {handoffs.pickings.map((picking) => (
        <li key={`p${picking.id}`}>
          <Link className="underline underline-offset-2" href={pickingHref(picking.id)} data-testid={`${testIdPrefix}-picking-${picking.id}`}>
            {picking.name || `Delivery #${picking.id}`}
          </Link>
          <span className="ml-2 text-muted-foreground">{picking.state}</span>
        </li>
      ))}
      {handoffs.invoices.map((invoice) => (
        <li key={`i${invoice.id}`}>
          <Link className="underline underline-offset-2" href={invoiceHref(invoice.id)} data-testid={`${testIdPrefix}-invoice-${invoice.id}`}>
            {invoice.name || `Invoice #${invoice.id}`}
          </Link>
          <span className="ml-2 text-muted-foreground">
            {invoice.state}{invoice.residual > 0 ? ` · open ${invoice.residual.toFixed(2)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  )
}
