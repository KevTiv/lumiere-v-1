"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import { reportExportSourceProvenance } from "@lumiere/ui/lib/report-export-provenance"
import type { BarChartWidget, AreaChartWidget } from "@lumiere/ui/lib/dashboard-types"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { DashboardWidgetRenderer } from "../../../../packages/ui/src/pages/dashboard-widget-renderer"
import { buildAccountantInsights, type InsightComparison, type InsightDays } from "./accountant-insights-model"
import type { AccountantOverviewData } from "./accountant-overview-model"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"

type ChartWidget = BarChartWidget | AreaChartWidget
function ReadNotice({ state }: { state: ModuleDataState }) {
  const { t } = useTranslation()
  const text = state.status === "loading" ? t("accounting.insights.loading") : state.status === "denied" ? t("accounting.insights.denied") : state.status === "partial" ? t("accounting.insights.partial") : t("accounting.insights.error")
  return <div role={state.status === "error" ? "alert" : "status"} className="flex min-h-24 flex-col items-start justify-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
    <p>{text}</p>{"onRetry" in state && state.onRetry && <Button variant="outline" onClick={state.onRetry}>{t("accounting.insights.retry")}</Button>}
  </div>
}

export function AccountantInsights({ data, now }: { data: AccountantOverviewData; now?: Date }) {
  const { t } = useTranslation()
  const [days, setDays] = useState<InsightDays>(90)
  const [currencyId, setCurrencyId] = useState<string>()
  const model = useMemo(() => buildAccountantInsights(data, days, currencyId, now), [data, days, currencyId, now])
  const currency = model.currency
  const currencyLabel = currency ? `${currency.label} (#${currency.id})` : t("accounting.insights.currencyUnavailable")
  const money = (value: number) => `${new Intl.NumberFormat(undefined, { minimumFractionDigits: currency?.decimals ?? 2, maximumFractionDigits: currency?.decimals ?? 2 }).format(value)} ${currency?.label ?? ""}`
  const date = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(value)
  const month = (value: number) => new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }).format(value)
  const periodLabel = `${date(model.startMs)} – ${date(model.endMs - 1)}`
  const previousLabel = `${date(model.previousStartMs)} – ${date(model.startMs - 1)}`
  const invoiceLabel = t("accounting.insights.invoices")
  const billLabel = t("accounting.insights.bills")
  const plannedLabel = t("accounting.insights.planned")
  const actualLabel = t("accounting.insights.actual")
  const series = [{ name: invoiceLabel, color: "hsl(var(--chart-1))" }, { name: billLabel, color: "hsl(var(--chart-2))" }]
  const agingNames = { current: t("accounting.insights.current"), "1-30": "1–30", "31-60": "31–60", "61-90": "61–90", "90+": "90+", undated: t("accounting.insights.undated") }

  function comparison(value: InsightComparison) {
    const Icon = (value.percent ?? 0) < 0 ? ArrowDownRight : ArrowUpRight
    return <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5">{value.percent === null ? t("accounting.insights.noBaseline") : <><Icon className="size-3.5 shrink-0" aria-hidden="true" /><span className="font-medium tabular-nums text-foreground">{value.percent > 0 ? "+" : ""}{new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value.percent)}%</span><span>{t("accounting.insights.vsPrevious")}</span></>}</p>
      <p>{t("accounting.insights.previous")}: {money(value.previous)}</p>
    </div>
  }
  function metric(title: string, state: ModuleDataState, value: number | undefined, hint: ReactNode, testId: string) {
    return <div className="min-w-0 space-y-3 p-4 sm:p-5" data-testid={testId}>
      <h3 className="text-xs font-medium leading-5 text-muted-foreground">{title}</h3>
      {state.status === "ready" && value !== undefined ? <><p className={`${workspaceStyles.metricValue} break-words text-xl sm:text-2xl`}>{money(value)}</p>{hint}</> : <ReadNotice state={state} />}
    </div>
  }
  function chart(widget: ChartWidget, state: ModuleDataState, hint: string, table: ReactNode, sourceModel = "account_move") {
    const title = `${widget.title} · ${currencyLabel}`
    const provenance = reportExportSourceProvenance({
      organizationId: data.organizationId, companyId: data.companyId, dashboardId: "accounting-financial-overview", widgetId: widget.id,
      model: sourceModel, domain: JSON.stringify({ currencyId: model.selectedId, basis: sourceModel === "crossovered_budget" ? "whole-approved-budgets-overlapping-period" : sourceModel === "account_bank_statement" ? "latest-closing-balance-per-bank-journal-at-month-end" : widget.id === "insight-aging" ? "current-posted-invoice-and-bill-residuals" : "posted-invoice-and-bill-totals-including-tax", ...(sourceModel === "crossovered_budget" ? { limit: 8, order: "name", budgetIds: model.budgets.value?.slice(0, 8).map((item) => item.id) } : sourceModel === "account_bank_statement" ? { cancelledStatements: "excluded" } : { creditNotes: "excluded" }) }),
      groupBy: widget.id === "insight-trend" || widget.id === "insight-bank-balance" ? "month" : widget.id === "insight-aging" ? "due-date-bucket" : "budget",
      startMs: widget.id === "insight-aging" ? model.asOfMs : model.startMs,
      endMs: widget.id === "insight-aging" ? model.asOfMs : model.endMs,
    })
    return <section className={`${workspaceStyles.surface} min-w-0 p-4 sm:p-5`} aria-label={title} data-testid={widget.id}>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">{hint}</p>
      {state.status === "ready" ? <>
        <DashboardWidgetRenderer widget={{ ...widget, title, useCard: false }} widthClass="min-w-0" exportProvenance={provenance} emptyMessage={t(sourceModel === "crossovered_budget" && model.budgets.value?.length === 0 ? "accounting.insights.noBudgets" : "accounting.insights.zeroAmounts")} />
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">{widget.data.series.map((item) => <span className="flex items-center gap-2" key={item.name}><span className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.name}</span>)}</div>
        {sourceModel === "crossovered_budget" && <ul className="mb-3 space-y-1 text-xs leading-5 text-muted-foreground">{model.budgets.value?.slice(0, 8).map((item) => <li key={item.id} className="break-words">#{item.id} · {item.name}</li>)}</ul>}
        {sourceModel === "crossovered_budget" && (model.budgets.value?.length ?? 0) > 8 && <p className="mb-3 text-xs text-muted-foreground">{t("accounting.insights.budgetChartLimit")}</p>}
        <details><summary className="flex w-fit cursor-pointer items-center rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("accounting.insights.viewData")}</summary>
          <div className="max-h-80 overflow-auto"><table className="w-full min-w-[26rem] text-right text-xs tabular-nums"><caption className="sr-only">{title}</caption>{table}</table></div>
        </details>
      </> : <><h3 className={`${workspaceStyles.sectionTitle} mb-3`}>{title}</h3><ReadNotice state={state} /></>}
    </section>
  }
  const dayMetric = (title: string, value: number | null | undefined, hint: string, testId: string) => <div className="min-w-0 space-y-3 p-4 sm:p-5" data-testid={testId}>
    <h3 className="text-xs font-medium leading-5 text-muted-foreground">{title}</h3>
    {model.turnover.state.status === "ready" && value !== undefined
      ? <><p className={`${workspaceStyles.metricValue} break-words text-xl sm:text-2xl`}>{value === null ? "—" : t("accounting.insights.daysValue", { count: Math.round(value) })}</p><p className="text-xs leading-5 text-muted-foreground">{value === null ? t("accounting.insights.noPostings") : hint}</p></>
      : <ReadNotice state={model.turnover.state} />}
  </div>
  const head = (first: string, left: string, right: string) => <thead><tr className="border-b"><th scope="col" className="py-3 pr-3 text-left font-medium">{first}</th><th scope="col" className="px-2 py-3 font-medium">{left}</th><th scope="col" className="pl-2 py-3 font-medium">{right}</th></tr></thead>
  const trend: AreaChartWidget = { id: "insight-trend", type: "area-chart", width: "full", title: t("accounting.insights.trendTitle"), data: { xAxisKey: "month", series, values: (model.period.value?.months ?? []).map((point) => ({ month: month(point.startMs), [invoiceLabel]: point.invoices, [billLabel]: point.bills })) } }
  const aging: BarChartWidget = { id: "insight-aging", type: "bar-chart", width: "full", title: t("accounting.insights.agingTitle"), data: { categoryKey: "bucket", layout: "horizontal", series, values: (model.aging.value ?? []).map((point) => ({ bucket: agingNames[point.bucket], [invoiceLabel]: point.invoices, [billLabel]: point.bills })) } }
  const balanceLabel = t("accounting.insights.bankBalance")
  const bankBalance: AreaChartWidget = { id: "insight-bank-balance", type: "area-chart", width: "full", title: t("accounting.insights.bankBalanceTitle"), data: { xAxisKey: "month", series: [{ name: balanceLabel, color: "hsl(var(--chart-1))" }], values: (model.cash.value?.months ?? []).flatMap((point) => point.balance === null ? [] : [{ month: month(point.startMs), [balanceLabel]: point.balance }]) } }
  const budgets: BarChartWidget = { id: "insight-budgets", type: "bar-chart", width: "full", title: t("accounting.insights.budgetTitle"), data: { categoryKey: "budget", series: [{ name: plannedLabel, color: "hsl(var(--chart-1))" }, { name: actualLabel, color: "hsl(var(--chart-2))" }], values: (model.budgets.value ?? []).slice(0, 8).map((point) => ({ budget: `#${point.id}`, [plannedLabel]: point.planned, [actualLabel]: point.actual })) } }

  return <div className="min-w-0 space-y-5 [&_button]:min-h-11 [&_button]:min-w-11 [&_summary]:min-h-11" data-testid="accountant-insights">
    <section aria-labelledby="financial-overview-title" className="space-y-4">
      <div className="flex min-w-0 flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="space-y-1"><h2 id="financial-overview-title" className="flex scroll-mt-24 items-center gap-2 text-lg font-semibold tracking-tight"><ChartNoAxesCombined className="size-5 text-primary" aria-hidden="true" />{t("accounting.insights.title")}</h2><p className={workspaceStyles.sectionDescription}>{t("accounting.insights.description")}</p></div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1 text-xs font-medium"><span>{t("accounting.insights.currency")}</span><Select
            value={model.selectedId || "__none__"}
            onValueChange={(nextValue) => setCurrencyId(nextValue === "__none__" ? undefined : nextValue)}
          >
            <SelectTrigger
              className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t("accounting.insights.currency")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!model.currency && (
                <SelectItem value={model.selectedId || "__none__"}>
                  {t("accounting.insights.currencyUnavailable")}
                </SelectItem>
              )}
              {model.currencies.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.label} (#{item.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select></label>
          <label className="min-w-0 space-y-1 text-xs font-medium"><span>{t("accounting.insights.period")}</span><Select
            value={String(days ?? "")}
            onValueChange={(nextValue) => setDays(Number(nextValue) as InsightDays)}
          >
            <SelectTrigger
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t("accounting.insights.period")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[30, 90, 180].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t("accounting.insights.lastDays", { count: value })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select></label>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" data-testid="insights-period-label">{periodLabel} · {t("accounting.insights.comparedWith")} {previousLabel}. {t("accounting.insights.utcHint")}</p>
      <div className={`${workspaceStyles.surface} grid min-w-0 divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 [&>div]:sm:border-b [&>div]:xl:border-b-0 [&>div:nth-child(even)]:sm:border-l [&>div:nth-child(3)]:xl:border-l`}>
        {metric(t("accounting.insights.openInvoices"), model.balances.state, model.balances.value?.invoices, <p className="text-xs leading-5 text-muted-foreground">{t("accounting.insights.currentBalanceHint")}</p>, "insight-open-invoices")}
        {metric(t("accounting.insights.openBills"), model.balances.state, model.balances.value?.bills, <p className="text-xs leading-5 text-muted-foreground">{t("accounting.insights.currentBalanceHint")}</p>, "insight-open-bills")}
        {metric(t("accounting.insights.postedInvoices"), model.period.state, model.period.value?.invoices.current, model.period.value ? comparison(model.period.value.invoices) : null, "insight-posted-invoices")}
        {metric(t("accounting.insights.postedBills"), model.period.state, model.period.value?.bills.current, model.period.value ? comparison(model.period.value.bills) : null, "insight-posted-bills")}
      </div>
      <div className={`${workspaceStyles.surface} grid min-w-0 divide-y sm:grid-cols-3 sm:divide-y-0 [&>div:not(:first-child)]:sm:border-l`}>
        {metric(t("accounting.insights.cashPosition"), model.cash.state, model.cash.value?.position, model.cash.value ? <p className="text-xs leading-5 text-muted-foreground">{model.cash.value.accounts === 0 ? t("accounting.insights.noBankStatements") : t("accounting.insights.cashHint", { count: model.cash.value.accounts, date: date(model.cash.value.asOfMs) })}</p> : null, "insight-cash-position")}
        {dayMetric(t("accounting.insights.dso"), model.turnover.value?.dso, t("accounting.insights.dsoHint", { count: days }), "insight-dso")}
        {dayMetric(t("accounting.insights.dpo"), model.turnover.value?.dpo, t("accounting.insights.dpoHint", { count: days }), "insight-dpo")}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t("accounting.insights.basisHint")}</p>
    </section>
    <section aria-labelledby="accounting-insights-title" className="space-y-4">
      <h2 id="accounting-insights-title" className="scroll-mt-24 text-lg font-semibold tracking-tight">{t("accounting.insights.insightsTitle")}</h2>
      {chart(trend, model.period.state, t("accounting.insights.trendHint"), <>{head(t("accounting.insights.month"), invoiceLabel, billLabel)}<tbody>{model.period.value?.months.map((point) => <tr key={point.startMs} className="border-b last:border-0"><th scope="row" className="py-3 pr-3 text-left font-normal">{month(point.startMs)}</th><td className="px-2 py-3">{money(point.invoices)}</td><td className="pl-2 py-3">{money(point.bills)}</td></tr>)}</tbody></>)}
      {chart(bankBalance, model.cash.state, t("accounting.insights.bankBalanceHint"), <>
        <thead><tr className="border-b"><th scope="col" className="py-3 pr-3 text-left font-medium">{t("accounting.insights.month")}</th><th scope="col" className="pl-2 py-3 font-medium">{balanceLabel}</th></tr></thead>
        <tbody>{model.cash.value?.months.map((point) => <tr key={point.startMs} className="border-b last:border-0"><th scope="row" className="py-3 pr-3 text-left font-normal">{month(point.startMs)}</th><td className="pl-2 py-3">{point.balance === null ? "—" : money(point.balance)}</td></tr>)}</tbody></>, "account_bank_statement")}
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {chart(aging, model.aging.state, t("accounting.insights.agingHint"), <>{head(t("accounting.insights.daysOverdue"), invoiceLabel, billLabel)}<tbody>{model.aging.value?.map((point) => <tr key={point.bucket} className="border-b last:border-0"><th scope="row" className="py-3 pr-3 text-left font-normal">{agingNames[point.bucket]}</th><td className="px-2 py-3">{money(point.invoices)}</td><td className="pl-2 py-3">{money(point.bills)}</td></tr>)}</tbody></>)}
        {chart(budgets, model.budgets.state, `${t("accounting.insights.budgetHint")} ${model.companyCurrencyId && model.companyCurrencyId !== model.selectedId ? t("accounting.insights.budgetCurrencyHint", { currency: model.currencies.find((item) => item.id === model.companyCurrencyId)?.label ?? `#${model.companyCurrencyId}` }) : ""}`, <>{head(t("accounting.insights.budget"), plannedLabel, actualLabel)}<tbody>{model.budgets.value?.map((point) => <tr key={point.id} className="border-b last:border-0"><th scope="row" className="max-w-48 break-words py-3 pr-3 text-left font-normal">{point.name} (#{point.id})</th><td className="px-2 py-3">{money(point.planned)}</td><td className="pl-2 py-3">{money(point.actual)}<span className="block text-muted-foreground">{t("accounting.insights.variance")}: {money(point.variance)}</span></td></tr>)}</tbody></>, "crossovered_budget")}
      </div>
      <nav aria-label={t("accounting.insights.browse")} className="flex flex-wrap gap-2">
        {[{ tab: "invoices", label: t("accounting.insights.browseInvoices") }, { tab: "bills", label: t("accounting.insights.browseBills") }].map((item) => <Link key={item.tab} className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" href={`/accounting?tab=${item.tab}&filter=${encodeURIComponent(`currencyId:${model.selectedId}`)}`}>{item.label}<ArrowUpRight className="size-3.5" /></Link>)}
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" href="/accounting?tab=budgets">{t("accounting.insights.browseBudgets")}<ArrowUpRight className="size-3.5" /></Link>
      </nav>
    </section>
  </div>
}
