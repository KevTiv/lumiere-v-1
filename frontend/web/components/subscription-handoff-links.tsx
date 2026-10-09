"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { accountMoveHref, accountPaymentHref } from "@lumiere/erp-shared/record-links"
import type { SubscriptionHandoffs } from "@lumiere/query-hooks/hooks/subscription-handoffs"

export function SubscriptionHandoffLinks({ handoffs }: { handoffs: SubscriptionHandoffs }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3" data-testid="subscription-handoffs">
      {handoffs.unavailable ? <p role="alert">{t("subscriptions.handoffs.unavailable")}</p> : null}
      {handoffs.invoices.length === 0 && handoffs.payments.length === 0 && !handoffs.unavailable ? (
        <p className="text-muted-foreground" data-testid="subscription-handoff-none">
          {t("subscriptions.handoffs.empty")}
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {handoffs.invoices.map((invoice) => (
            <li key={`invoice-${invoice.id}`}>
              <Link className="underline underline-offset-2" href={accountMoveHref(invoice.id)}
                data-testid={`subscription-handoff-invoice-${invoice.id}`}>
                {invoice.name || t("subscriptions.handoffs.invoice", { id: String(invoice.id) })}
              </Link>
              <span className="ml-2 text-muted-foreground">{invoice.state}</span>
            </li>
          ))}
          {handoffs.payments.map((payment) => (
            <li key={`payment-${payment.id}`}>
              <Link className="underline underline-offset-2" href={accountPaymentHref(payment.id)}
                data-testid={`subscription-handoff-payment-${payment.id}`}>
                {payment.name || t("subscriptions.handoffs.payment", { id: String(payment.id) })}
              </Link>
              <span className="ml-2 text-muted-foreground">{payment.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
