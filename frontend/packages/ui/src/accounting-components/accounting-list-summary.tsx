import { X } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { formatInvoiceMoney } from "./invoice-document"
import type { AccountingCurrencySummary, AccountingListDisplayProps } from "./accounting-list-display"

export function AccountingListFilters({ initialFilters = {}, onInitialFilterClear }: Pick<AccountingListDisplayProps, "initialFilters" | "onInitialFilterClear">) {
  const { t } = useTranslation()
  return Object.keys(initialFilters).length ? <div className="flex flex-wrap items-center gap-2" aria-label={t("accounting.worklists.linkedFilterLabel", { defaultValue: "Linked record filters" })}>
    {Object.entries(initialFilters).map(([key, value]) => <span key={key} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <span className="break-all">{key}: {value}</span>
      {onInitialFilterClear ? <Button variant="ghost" size="icon" className="size-5" aria-label={t("accounting.accountingListSummary.clearValueFilter", { defaultValue: "Clear {{key}} filter", key: key })} onClick={() => onInitialFilterClear(key)}><X className="size-3" /></Button> : null}
    </span>)}
  </div> : null
}

export function AccountingListSummary({ groups }: { groups: readonly AccountingCurrencySummary[] }) {
  const { t } = useTranslation()
  if (groups.length < 2) return null
  return <div className="grid gap-2 sm:grid-cols-2" aria-label={t("accounting.accountingListSummary.totalsByCurrency", { defaultValue: "Totals by currency" })}>
    {groups.map((group) => <dl key={group.key} className="min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
      <dt className="font-medium">{group.label}</dt>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><dt className="text-muted-foreground">{t("accounting.invoices.total", { defaultValue: "Total" })}</dt><dd className="break-words tabular-nums">{group.total == null ? "—" : formatInvoiceMoney(group.total, group.currency)}</dd></div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><dt className="text-muted-foreground">{t("accounting.invoices.balanceDue", { defaultValue: "Balance due" })}</dt><dd className="break-words tabular-nums">{group.residual == null ? "—" : formatInvoiceMoney(group.residual, group.currency)}</dd></div>
    </dl>)}
  </div>
}
