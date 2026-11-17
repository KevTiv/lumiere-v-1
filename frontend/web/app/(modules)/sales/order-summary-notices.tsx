"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"

export function OrderSummaryNotices({ lines, transfers, invoices }: {
  lines: ModuleDataState
  transfers: ModuleDataState
  invoices: ModuleDataState
}) {
  const { t } = useTranslation()
  const sources = [
    { id: "lines", label: t("sales.orderLines.title"), state: lines },
    { id: "transfers", label: t("sales.salesOrders.columns.deliverySummary"), state: transfers },
    { id: "invoices", label: t("sales.salesOrders.columns.invoiceSummary"), state: invoices },
  ].filter(({ state }) => state.status !== "ready")

  if (sources.length === 0) return null
  return (
    <div className="space-y-2">
      {sources.map(({ id, label, state }) => (
        <section key={id} aria-label={label}>
          {state.status === "loading" ? (
            <p role="status" className="text-sm text-muted-foreground">{label} · {t("common.loading")}</p>
          ) : (
            <ModuleDataNotice
              state={state.status === "denied"
                ? { ...state, message: `${label} · ${t("common.recordsDenied")}` }
                : {
                  status: "error",
                  message: `${label} · ${t("common.recordsUnavailable")}`,
                  onRetry: "onRetry" in state ? state.onRetry : undefined,
                }}
            />
          )}
        </section>
      ))}
    </div>
  )
}
