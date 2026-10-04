"use client"

import Link from "next/link"

import { accountMoveHref, saleOrderHref, stockPickingHref } from "@lumiere/erp-shared/record-links"
import type { OrderHandoffs } from "@lumiere/query-hooks/hooks/order-to-cash"
import type { CrossRecordLinks as Result } from "@lumiere/query-hooks/hooks/cross-record-links"

export { saleOrderHref as orderHref, stockPickingHref as pickingHref, accountMoveHref as invoiceHref }
/** Read-only cross-record navigation shares the handoff presentation owner. */
export function CrossRecordLinks({ result, testIdPrefix }: { result: Result; testIdPrefix: string }) {
  if (result.status !== "ready") {
    return <p role="alert" data-testid={`${testIdPrefix}-${result.status}`}>{result.reason}</p>
  }
  if (result.links.length === 0 && !result.paymentNotice) return <p data-testid={`${testIdPrefix}-none`}>No linked records yet</p>
  return (
    <>
    {result.paymentNotice ? (
      <p role="alert" data-testid={`${testIdPrefix}-payment-${result.paymentNotice.status}`}>{result.paymentNotice.reason}</p>
    ) : null}
    <ul data-testid={`${testIdPrefix}-list`} className="flex flex-col gap-2 p-4">
      {result.links.map((link) => (
        <li key={`${link.kind}-${link.id}`}>
          <Link href={link.href} data-testid={`${testIdPrefix}-${link.kind}-${link.id}`} className="underline underline-offset-2">
            {link.kind}: {link.label}
          </Link>
        </li>
      ))}
    </ul>
    </>
  )
}

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
          <Link className="underline underline-offset-2" href={stockPickingHref(picking.id)} data-testid={`${testIdPrefix}-picking-${picking.id}`}>
            {picking.name || `Delivery #${picking.id}`}
          </Link>
          <span className="ml-2 text-muted-foreground">{picking.state}</span>
        </li>
      ))}
      {handoffs.invoices.map((invoice) => (
        <li key={`i${invoice.id}`}>
          <Link className="underline underline-offset-2" href={accountMoveHref(invoice.id)} data-testid={`${testIdPrefix}-invoice-${invoice.id}`}>
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
