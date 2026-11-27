"use client"

import { useTranslation } from "@lumiere/i18n"
import type { InboxDelivery } from "./crm-inbox-delivery"

export function CrmInboxDeliveryStatus({ delivery }: { delivery: InboxDelivery }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p data-testid="crm-inbox-delivery-status">{t(`crm.inbox.delivery.${delivery.status}`)}</p>
      {"providerMessageId" in delivery && (
        <p className="[overflow-wrap:anywhere]">
          {t("crm.inbox.delivery.reference", { reference: delivery.providerMessageId })}
        </p>
      )}
      {delivery.status === "failed" && (
        <p className="[overflow-wrap:anywhere]">
          {delivery.reason ? t("crm.inbox.delivery.reason", { reason: delivery.reason }) : t("crm.inbox.delivery.reasonUnavailable")}
        </p>
      )}
    </div>
  )
}
