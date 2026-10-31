"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight, ChartNoAxesCombined } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { Button } from "@lumiere/ui/components/button"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import type { DashboardSection, AreaChartWidget, BarChartWidget } from "@lumiere/ui/lib/dashboard-types"
import { reportExportSourceProvenance } from "@lumiere/ui/lib/report-export-provenance"
import { DashboardGrid } from "../../packages/ui/src/pages/dashboard-grid"
import { DashboardWidgetRenderer } from "../../packages/ui/src/pages/dashboard-widget-renderer"
import { buildModuleInsights, insightDefinitions, insightRecordHref, type InsightPeriod, type ModuleInsightInput } from "../lib/module-insights-model"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@lumiere/ui/components/select"

function SourceNotice({ state }: { state: ModuleDataState }) {
  const { t } = useTranslation()
  return <div role={state.status === "error" ? "alert" : "status"} className="flex min-h-24 flex-col items-start justify-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
    <p>{t(`moduleInsights.source.${state.status === "ready" ? "partial" : state.status}`)}</p>
    {"onRetry" in state && state.onRetry && <Button variant="outline" onClick={state.onRetry}>{t("common.retry")}</Button>}
  </div>
}

/** One composition for module dashboards; figures are derived only from explicit read projections. */
export interface InsightPeriodRange { startMs: number; endMs: number }
interface ModuleInsightsProps { input: ModuleInsightInput; sections?: DashboardSection[]; now?: Date; onPeriodRangeChange?: (range: InsightPeriodRange) => void }

export function CompanyModuleInsights(props: ModuleInsightsProps) {
  const { input } = props
  const organizationId = Number(input.organizationId)
  const companies = useCompanies(organizationId, input.module !== "reports" && Number.isSafeInteger(organizationId) && organizationId > 0)
  const companyCurrencyId = companies.data?.find((company) => String(company.id) === String(input.companyId))?.currencyId
  return <ModuleInsights {...props} input={{ ...input, companyCurrencyId: input.companyCurrencyId ?? companyCurrencyId }} />
}

export function ModuleInsights({ input, sections = [], now, onPeriodRangeChange }: ModuleInsightsProps) {
  // A company switch remounts controls instead of retaining an old company's currency or queue.
  return <ScopedModuleInsights key={`${input.module}:${input.organizationId}:${input.companyId}`} input={input} sections={sections} now={now} onPeriodRangeChange={onPeriodRangeChange} />
}

function ScopedModuleInsights({ input, sections = [], now, onPeriodRangeChange }: ModuleInsightsProps) {
  const { t } = useTranslation()
  const [days, setDays] = useState<InsightPeriod>(90)
  const [currencyId, setCurrencyId] = useState<string>()
  const [queueKey, setQueueKey] = useState<string>()
  const model = useMemo(() => buildModuleInsights(input, days, currencyId, now), [input, days, currencyId, now])
  useEffect(() => { onPeriodRangeChange?.({ startMs: model.startMs, endMs: model.endMs }) }, [model.startMs, model.endMs, onPeriodRangeChange])
  const label = (key: string) => t(`moduleInsights.modules.${input.module}.${key}`)
  const status = (key: string) => t(`moduleInsights.states.${key}`)
  const money = (value: number) => `${new Intl.NumberFormat(undefined, { minimumFractionDigits: model.currency?.decimals ?? 2, maximumFractionDigits: model.currency?.decimals ?? 2 }).format(value)} ${model.currency?.label ?? ""}`
  const formatValue = (value: number) => model.monetary ? money(value) : new Intl.NumberFormat().format(value)
  const date = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(value)
  const month = (value: number) => new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }).format(value)
  const unit = model.monetary ? `${model.currency?.label ?? t("moduleInsights.unknownCurrency")} (#${model.selectedId || "—"})` : t("moduleInsights.records")
  const sectionId = (key: string) => `${input.module}-insights-${key}`
  const quickSections = sections.map((section) => ({ ...section, widgets: section.widgets.filter((widget) => widget.type === "quick-actions") })).filter((section) => section.widgets.length)
  const hasCompanyForecast = quickSections.some((section) => section.widgets.some((widget) => widget.type === "quick-actions" && widget.data.actions.some((action) => action.id === "create_forecast_snapshot")))
  const selectedQueue = model.queues.value?.find((queue) => queue.key === queueKey)
  const shownQueue = selectedQueue ?? model.queues.value?.[0]
  const trend: AreaChartWidget = { id: sectionId("trend"), title: `${label("trend")} · ${unit}`, type: "area-chart", width: "full", useCard: false, data: { xAxisKey: "month", allowDecimals: model.monetary ? undefined : false, series: [{ name: label("measure"), color: "hsl(var(--chart-1))" }], values: (model.period.value?.months ?? []).map((point) => ({ month: month(point.startMs), [label("measure")]: point.value })) } }
  const breakdown: BarChartWidget = { id: sectionId("states"), title: label("distribution"), type: "bar-chart", width: "full", useCard: false, data: { categoryKey: "state", layout: "horizontal", allowDecimals: false, series: [{ name: t("moduleInsights.records"), color: "hsl(var(--chart-2))" }], values: (model.counts.value?.states ?? []).map((point) => ({ state: status(point.status), [t("moduleInsights.records")]: point.count })) } }
  const previous = (value: number | undefined) => value === undefined ? null : <p className="text-xs leading-5 text-muted-foreground">{t("moduleInsights.previous")}: {new Intl.NumberFormat().format(value)}</p>
  const metric = (key: string, state: ModuleDataState, value: number | undefined, hint: ReactNode, monetary = false) => <div className="min-w-0 space-y-3 p-4 sm:p-5" data-testid={sectionId(key)}>
    <h3 className="text-xs font-medium leading-5 text-muted-foreground">{label(key)}</h3>
    {state.status === "ready" && value !== undefined ? <><p className={`${workspaceStyles.metricValue} break-words text-xl sm:text-2xl`}>{monetary ? formatValue(value) : new Intl.NumberFormat().format(value)}</p>{hint}</> : <SourceNotice state={state} />}
  </div>
  const tableHead = (first: string, second: string) => <thead><tr className="border-b"><th scope="col" className="py-3 pr-3 text-left font-medium">{first}</th><th scope="col" className="py-3 text-right font-medium">{second}</th></tr></thead>
  const chart = (widget: AreaChartWidget | BarChartWidget, state: ModuleDataState, hint: string, table: ReactNode, current = false) => <section className={`${workspaceStyles.surface} min-w-0 p-4 sm:p-5`} aria-label={widget.title} data-testid={widget.id}>
    <p className="mb-3 text-xs leading-5 text-muted-foreground">{hint}</p>
    {state.status === "ready" ? <>
      <DashboardWidgetRenderer widget={widget} widthClass="min-w-0" emptyMessage={t("moduleInsights.zero")} exportProvenance={reportExportSourceProvenance({ organizationId: input.organizationId, companyId: input.companyId, dashboardId: `${input.module}-overview`, widgetId: widget.id, model: model.definition.model, domain: JSON.stringify({ currencyId: model.monetary ? model.selectedId : null, basis: current ? "current-record-states" : "current-eligible-records-by-creation-or-order-date", eligibleStates: current ? model.definition.states : model.definition.eligible, dateField: current ? null : model.definition.dateField, measure: current || !model.monetary ? "count" : input.module === "crm" ? "expectedRevenue" : input.module === "expenses" ? "totalAmount" : "amountTotal" }), groupBy: current ? "state" : "month", startMs: current ? model.asOfMs : model.startMs, endMs: current ? model.asOfMs : model.endMs })} />
      <details><summary className="flex min-h-11 w-fit cursor-pointer items-center rounded-sm text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("moduleInsights.viewData")}</summary><div className="max-h-80 overflow-auto"><table className="w-full min-w-72 text-xs tabular-nums"><caption className="sr-only">{widget.title}</caption>{table}</table></div></details>
    </> : <><h3 className={`${workspaceStyles.sectionTitle} mb-3`}>{widget.title}</h3><SourceNotice state={state} /></>}
  </section>
  const browseHref = `/${input.module}?tab=${insightDefinitions[input.module].tab}${model.monetary && model.selectedId ? `&filter=${encodeURIComponent(`${input.module === "crm" ? "companyCurrencyId" : "currencyId"}:${model.selectedId}`)}` : ""}`
  const linkClass = "inline-flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
  return <div className="min-w-0 space-y-6 [&_button]:min-h-11 [&_button]:min-w-11" data-testid={`module-insights-${input.module}`}>
    <nav aria-label={t("moduleInsights.sections")} className="flex flex-wrap gap-2">{["overview", "insights", "actions"].map((key) => <a className={linkClass} key={key} href={`#${sectionId(key)}`}>{t(`moduleInsights.${key}`)}</a>)}</nav>
    <section aria-labelledby={sectionId("overview")} className="space-y-4">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div className="space-y-1"><h2 id={sectionId("overview")} className="flex scroll-mt-24 items-center gap-2 text-lg font-semibold tracking-tight"><ChartNoAxesCombined aria-hidden="true" className="size-5 text-primary" />{label("title")}</h2><p className={workspaceStyles.sectionDescription}>{label("description")}</p></div>
        <div className={`grid min-w-0 gap-3 ${model.monetary ? "sm:grid-cols-2" : "sm:min-w-56"}`}>{model.monetary && <label className="min-w-0 space-y-1 text-xs font-medium"><span>{t("moduleInsights.currency")}</span><Select
          value={model.selectedId || "__none__"}
          onValueChange={(nextValue) => {
            setCurrencyId(nextValue === "__none__" ? undefined : nextValue)
            setQueueKey(undefined)
          }}
        >
          {" "}
          <SelectTrigger
            aria-label={t("moduleInsights.currency")}
            className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
          >
            <SelectValue />
          </SelectTrigger>{" "}
          <SelectContent>
            {!model.currency && (
              <SelectItem value={model.selectedId || "__none__"}>
                {t("moduleInsights.unknownCurrency")}
              </SelectItem>
            )}
            {model.currencies.map((currency) => (
              <SelectItem key={currency.id} value={String(currency.id)}>
                {currency.label} (#{currency.id})
              </SelectItem>
            ))}
          </SelectContent>{" "}
        </Select></label>}
          <label className="space-y-1 text-xs font-medium"><span>{t("moduleInsights.period")}</span><Select
            value={String(days ?? "")}
            onValueChange={(nextValue) => setDays(Number(nextValue) as InsightPeriod)}
          >
            {" "}
            <SelectTrigger
              aria-label={t("moduleInsights.period")}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              <SelectValue />
            </SelectTrigger>{" "}
            <SelectContent>
              {[30, 90, 180].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t("moduleInsights.lastDays", { count: value })}
                </SelectItem>
              ))}
            </SelectContent>{" "}
          </Select></label>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{date(model.startMs)} – {date(model.endMs - 1)} · {t("moduleInsights.comparedWith")} {date(model.previousStartMs)} – {date(model.startMs - 1)}. {t("moduleInsights.utc")}</p>
      <div className={`${workspaceStyles.surface} grid min-w-0 divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 [&>div]:sm:border-b [&>div]:xl:border-b-0 [&>div:nth-child(even)]:sm:border-l [&>div:nth-child(3)]:xl:border-l`}>
        {metric("currentValue", model.totals.state, model.totals.value?.amount, <p className="text-xs leading-5 text-muted-foreground">{t("moduleInsights.currentHint")}</p>, true)}
        {metric("currentCount", model.counts.state, model.counts.value?.current, <p className="text-xs leading-5 text-muted-foreground">{t("moduleInsights.currentHint")}</p>)}
        {metric("periodValue", model.period.state, model.period.value?.current, model.period.value && <div className="space-y-1 text-xs leading-5 text-muted-foreground"><p>{model.period.value.percent === null ? t("moduleInsights.noBaseline") : `${model.period.value.percent > 0 ? "+" : ""}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(model.period.value.percent)}% ${t("moduleInsights.vsPrevious")}`}</p><p>{t("moduleInsights.previous")}: {formatValue(model.period.value.previous)}</p></div>, true)}
        {metric("periodCount", model.periodCounts.state, model.periodCounts.value?.current, previous(model.periodCounts.value?.previous))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{label("basis")}</p>
    </section>
    <section aria-labelledby={sectionId("insights")} className="space-y-4"><h2 id={sectionId("insights")} className="scroll-mt-24 text-lg font-semibold tracking-tight">{t("moduleInsights.insights")}</h2>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {chart(trend, model.period.state, label("trendHint"), <>{tableHead(t("moduleInsights.month"), label("measure"))}<tbody>{model.period.value?.months.map((point) => <tr key={point.startMs} className="border-b last:border-0"><th scope="row" className="py-3 pr-3 text-left font-normal">{month(point.startMs)}</th><td className="py-3 text-right">{formatValue(point.value)}</td></tr>)}</tbody></>)}
        {chart(breakdown, model.counts.state, t("moduleInsights.distributionHint"), <>{tableHead(t("moduleInsights.state"), t("moduleInsights.records"))}<tbody>{model.counts.value?.states.map((point) => <tr key={point.status} className="border-b last:border-0"><th scope="row" className="py-3 pr-3 text-left font-normal">{status(point.status)}</th><td className="py-3 text-right">{point.count}</td></tr>)}</tbody></>, true)}
      </div>
    </section>
    <section aria-labelledby={sectionId("actions")} className="space-y-4"><h2 id={sectionId("actions")} className="scroll-mt-24 text-lg font-semibold tracking-tight">{t("moduleInsights.actions")}</h2><p className="text-xs text-muted-foreground">{t("moduleInsights.queueHint")}</p>
      {model.queues.value ? <><div className="grid gap-3 sm:grid-cols-3">{model.queues.value.map((queue) => <button key={queue.key} type="button" aria-pressed={shownQueue?.key === queue.key} className={`${workspaceStyles.surface} flex min-w-0 items-center justify-between gap-3 p-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${shownQueue?.key === queue.key ? "ring-1 ring-primary" : ""}`} data-testid={sectionId(`queue-${queue.key}`)} onClick={() => setQueueKey(queue.key)}><span className="text-sm">{status(queue.key)}</span><span className="text-xl font-semibold tabular-nums">{queue.records.length}</span></button>)}</div>
        <div className={`${workspaceStyles.surface} space-y-2 p-4`} aria-label={shownQueue ? status(shownQueue.key) : t("moduleInsights.actions")} data-testid={sectionId("queue-records")}><p className="text-xs text-muted-foreground">{t("moduleInsights.firstFive")}</p>{shownQueue?.records.length ? shownQueue.records.slice(0, 5).map((record) => <Link key={record.id} className={`${linkClass} w-full`} href={insightRecordHref(input.module, record.id)}><span className="min-w-0 break-words">{record.name}</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>) : <p className="py-3 text-sm text-muted-foreground">{t("moduleInsights.queueEmpty")}</p>}</div>
      </> : <SourceNotice state={model.queues.state} />}
      <div className="flex flex-wrap gap-2"><Link className={linkClass} href={browseHref}>{model.monetary && !model.selectedId ? t("moduleInsights.browseRecords") : label("browse")}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>{model.definition.more.map((tab) => <Link key={tab} className={linkClass} href={`/${input.module}?tab=${tab}`}>{t(`moduleInsights.workspaces.${tab}`)}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>)}</div>
      {input.module === "sales" && <details><summary className="flex min-h-11 w-fit cursor-pointer items-center rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("moduleInsights.moreQueues")}</summary><nav aria-label={t("moduleInsights.moreQueues")} className="flex flex-wrap gap-2 pt-2">{[
        ["credit_holds", "creditHolds"], ["returns_receive", "returnsToReceive"], ["open_deliveries", "openDeliveries"],
        ["commissions_to_accrue", "commissionsToAccrue"], ["commissions_accrued", "commissionsAccrued"], ["commissions_settled", "commissionsSettled"],
      ].map(([queue, key]) => <Link key={queue} className={linkClass} href={`/sales?tab=ops&queue=${queue}`}>{t(`sales.dashboard.queues.${key}`)}<ArrowUpRight aria-hidden="true" className="size-4" /></Link>)}</nav></details>}
      {hasCompanyForecast && <p className="text-xs leading-5 text-muted-foreground">{t("moduleInsights.forecastHint")}</p>}
      {quickSections.length > 0 && <DashboardGrid sections={quickSections} />}
    </section>
    <section aria-labelledby={sectionId("recent")} className={`${workspaceStyles.surface} min-w-0 space-y-3 p-4 sm:p-5`}><h2 id={sectionId("recent")} className={workspaceStyles.sectionTitle}>{t("moduleInsights.recent")}</h2><p className="text-xs text-muted-foreground">{t("moduleInsights.recentHint")}</p>{model.recent.value ? <ul className="divide-y">{model.recent.value.length ? model.recent.value.map((record) => <li key={record.id}><Link className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-sm py-3 text-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-ring" href={insightRecordHref(input.module, record.id)}><span className="min-w-0 break-words">{record.name}</span><span className="text-xs text-muted-foreground">{status(record.status)} · {date(record.time)}</span></Link></li>) : <li className="py-3 text-sm text-muted-foreground">{t("moduleInsights.queueEmpty")}</li>}</ul> : <SourceNotice state={model.recent.state} />}</section>
  </div>
}
