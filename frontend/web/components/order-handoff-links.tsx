"use client"

import Link from "next/link"

import { accountMoveHref, accountPaymentHref, returnOrderHref, saleOrderHref, stockPickingHref } from "@lumiere/erp-shared/record-links"
import type { OrderHandoffs } from "@lumiere/query-hooks/hooks/order-to-cash"
import type { CrossRecordLinks as Result } from "@lumiere/query-hooks/hooks/cross-record-links"

export { saleOrderHref as orderHref, stockPickingHref as pickingHref, accountMoveHref as invoiceHref }
/** Read-only cross-record navigation shares the handoff presentation owner. */
export function CrossRecordLinks({
  result, testIdPrefix, emptyLabel = "No linked records yet",
}: { result: Result; testIdPrefix: string; emptyLabel?: string }) {
  if (result.status !== "ready") {
    return <p role="alert" className="text-xs text-destructive" data-testid={`${testIdPrefix}-${result.status}`}>{result.reason}</p>
  }
  if (result.links.length === 0 && !result.paymentNotice) return <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-none`}>{emptyLabel}</p>
  return (
    <div className="space-y-2">
    {result.paymentNotice ? (
      <p role="alert" className="text-xs text-amber-700 dark:text-amber-300" data-testid={`${testIdPrefix}-payment-${result.paymentNotice.status}`}>{result.paymentNotice.reason}</p>
    ) : null}
    <ul data-testid={`${testIdPrefix}-list`} className="flex flex-wrap items-center gap-2 p-2">
      {result.links.map((link) => (
        <li key={`${link.kind}-${link.id}`}>
          <Link
            href={link.href}
            data-testid={`${testIdPrefix}-${link.kind}-${link.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
            <span className="text-muted-foreground">{link.kind}:</span>
            <span className="font-mono">{link.label}</span>
          </Link>
        </li>
      ))}
    </ul>
    </div>
  )
}

function handoffToneDot(state?: string): string {
  const normalized = (state ?? "").toLowerCase()
  if (normalized.includes("paid") || normalized.includes("done") || normalized.includes("posted") || normalized.includes("completed")) {
    return "bg-emerald-500"
  }
  if (normalized.includes("cancel") || normalized.includes("reject")) {
    return "bg-destructive"
  }
  if (normalized.includes("draft") || normalized.includes("waiting") || normalized.includes("pending")) {
    return "bg-amber-500"
  }
  return "bg-sky-500"
}

/**
 * COV-25: the deliveries and customer invoices an order generated, each linking straight to
 * its record so an operator never searches another module for them. `testIdPrefix` keeps
 * each surface's links addressable (`{prefix}-picking-{id}`, `{prefix}-invoice-{id}`).
 */
export function OrderHandoffLinks({
  handoffs, testIdPrefix, emptyLabel = "No deliveries or invoices yet",
  pickingLabel = "Delivery", invoiceLabel = "Invoice",
}: {
  handoffs: OrderHandoffs
  testIdPrefix: string
  emptyLabel?: string
  pickingLabel?: string
  invoiceLabel?: string
}) {
  if (handoffs.pickings.length === 0 && handoffs.invoices.length === 0 && (handoffs.returns?.length ?? 0) === 0 && (handoffs.payments?.length ?? 0) === 0) {
    return <span className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-none`}>{emptyLabel}</span>
  }
  const pillClass =
    "inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs shadow-2xs transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  return (
    <ul className="flex flex-wrap items-center gap-2 text-xs" data-testid={`${testIdPrefix}-list`}>
      {handoffs.pickings.map((picking) => (
        <li key={`p${picking.id}`}>
          <Link className={pillClass} href={stockPickingHref(picking.id)} data-testid={`${testIdPrefix}-picking-${picking.id}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${handoffToneDot(picking.state)}`} aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{picking.name || `${pickingLabel} #${picking.id}`}</span>
            <span className="text-muted-foreground">{picking.state}</span>
          </Link>
        </li>
      ))}
      {handoffs.invoices.map((invoice) => (
        <li key={`i${invoice.id}`}>
          <Link className={pillClass} href={accountMoveHref(invoice.id)} data-testid={`${testIdPrefix}-invoice-${invoice.id}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${handoffToneDot(invoice.state)}`} aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{invoice.name || `${invoiceLabel} #${invoice.id}`}</span>
            <span className="tabular-nums text-muted-foreground">
              {invoice.state}{invoice.residual > 0 ? ` · open ${invoice.residual.toFixed(2)}` : ""}
            </span>
          </Link>
        </li>
      ))}
      {(handoffs.returns ?? []).map((returned) => (
        <li key={`r${returned.id}`}>
          <Link className={pillClass} href={returnOrderHref(returned.id)} data-testid={`${testIdPrefix}-return-${returned.id}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${handoffToneDot(returned.state)}`} aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{returned.name || `Return #${returned.id}`}</span>
            <span className="text-muted-foreground">{returned.state}</span>
          </Link>
        </li>
      ))}
      {(handoffs.payments ?? []).map((payment) => (
        <li key={`pay${payment.id}`}>
          <Link className={pillClass} href={accountPaymentHref(payment.id)} data-testid={`${testIdPrefix}-payment-${payment.id}`}>
            <span className={`size-1.5 shrink-0 rounded-full ${handoffToneDot(payment.state)}`} aria-hidden="true" />
            <span className="font-mono font-medium text-foreground">{payment.name || `Payment #${payment.id}`}</span>
            <span className="text-muted-foreground">{payment.state}</span>
          </Link>
        </li>
      ))}
      {handoffs.paymentNotice ? (
        <li role="alert" data-testid={`${testIdPrefix}-payment-${handoffs.paymentNotice}`} className="text-xs text-amber-700 dark:text-amber-300">
          {handoffs.paymentNotice === "relation_unavailable"
            ? "Payment relation is unavailable"
            : "Payment relation failed its identity check"}
        </li>
      ) : null}
    </ul>
  )
}
