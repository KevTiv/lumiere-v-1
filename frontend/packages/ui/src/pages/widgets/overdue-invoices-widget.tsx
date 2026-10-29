"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useCurrencyFormat } from "../../lib/currency-context"

interface OverdueInvoicesData {
  count: number
  totalAmount: number
  oldestDays: number
}

export function OverdueInvoicesWidget({ data }: { data: OverdueInvoicesData }) {
  useTranslation()
  const { money } = useCurrencyFormat()
  const status = data.count === 0 ? "green" : data.oldestDays > 60 ? "red" : "amber"
  const colorClass =
    status === "green" ? "text-success" : status === "red" ? "text-destructive" : "text-warning"
  const bgClass =
    status === "green"
      ? "bg-success/10"
      : status === "red"
        ? "bg-destructive/10"
        : "bg-warning/10"

  return (
    <div className={`rounded-lg p-4 ${bgClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-3xl font-bold ${colorClass}`}>{data.count}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {i18n.t("ui.pages.overdueInvoicesWidget.overdueInvoices", { count: data.count })}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold ${colorClass}`}>{money(data.totalAmount)}</p>
          <p className="text-xs text-muted-foreground">{i18n.t("ui.pages.overdueInvoicesWidget.totalOutstanding")}</p>
        </div>
      </div>
      {data.count > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          {i18n.t("ui.pages.overdueInvoicesWidget.oldestOverdue", { count: data.oldestDays })}</p>
      )}
    </div>
  )
}
