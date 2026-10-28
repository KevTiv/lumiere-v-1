"use client"

import type { ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { reportDate, reportTag, type ReportRow } from "./report-workspace-model"

export const REPORT_CHOICES = ["trialBalance", "profitAndLoss", "balanceSheet", "cashFlow", "generalLedger"] as const

export function ReportStart({ onGenerate, canGenerate, sourceState, reportTypes = REPORT_CHOICES, children }: {
  onGenerate: (type: string) => void
  canGenerate: boolean
  sourceState: ModuleDataState
  reportTypes?: readonly string[]
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return <section className="space-y-6" data-testid="report-start">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div><h2 className="text-xl font-semibold">{t("reports.workspace.run")}</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("reports.workspace.runHint")}</p></div>
      {canGenerate && <Button onClick={() => onGenerate("trialBalance")} disabled={sourceState.status !== "ready"}>{t("reports.workspace.generate")}</Button>}
    </div>
    <ModuleDataNotice state={sourceState} />
    {sourceState.status === "loading" && <p role="status">{t("common.loading")}</p>}
    <div className="grid gap-x-8 sm:grid-cols-2" aria-label={t("reports.workspace.reportTypes")}>
      {reportTypes.map((type) => <div key={type} className="flex min-w-0 items-start justify-between gap-3 border-b py-4">
        <div className="min-w-0"><h3 className="font-medium">{t(`reports.forms.generateReport.fields.reportTypes.${type}`)}</h3><p className="mt-1 text-sm text-muted-foreground">{t(`reports.workspace.descriptions.${type}`)}</p></div>
        {canGenerate && <Button className="shrink-0" variant="outline" size="sm" disabled={sourceState.status !== "ready"} aria-label={t("reports.workspace.runType", { type: t(`reports.forms.generateReport.fields.reportTypes.${type}`) })} onClick={() => onGenerate(type)}>{t("reports.workspace.runShort")}</Button>}
      </div>)}
    </div>
    {!canGenerate && <p className="text-sm text-muted-foreground">{t("reports.workspace.readOnly")}</p>}
    {children}
  </section>
}

export function ReportResult({ report, sourceState, companyLabel, currencyLabel, onBack, actions, actionError, children }: {
  report: ReportRow | null
  sourceState: ModuleDataState
  companyLabel: string
  currencyLabel: string
  onBack: () => void
  actions?: ReactNode
  actionError?: string | null
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  return <section className="space-y-5" data-testid="report-result">
    <Button variant="outline" onClick={onBack}>{t("reports.workspace.back")}</Button>
    <ModuleDataNotice state={sourceState} />
    {sourceState.status === "loading" && <p role="status">{t("common.loading")}</p>}
    {sourceState.status === "ready" && !report ? <p role="status">{t("reports.workspace.unavailable")}</p> : null}
    {sourceState.status === "ready" && report ? <>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0"><h2 className="break-words text-xl font-semibold">{String(report.name ?? `#${String(report.id)}`)}</h2><p className="mt-1 text-sm text-muted-foreground">{t(`reports.financialReports.states.${reportTag(report.state)}`, { defaultValue: t("reports.workspace.unknown") })}</p></div>
        <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
      </div>
      <dl className="grid gap-4 border-b pb-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("reports.workspace.company"), companyLabel],
          [t("reports.workspace.period"), `${reportDate(report.dateFrom ?? report.date_from, i18n.language)} – ${reportDate(report.dateTo ?? report.date_to, i18n.language)}`],
          [t("reports.workspace.currency"), currencyLabel],
          [t("reports.workspace.basis"), report.targetMove === "posted" ? t("reports.workspace.posted") : report.targetMove === "all" ? t("reports.workspace.allEntries") : t("reports.workspace.unknown")],
          [t("reports.workspace.comparison"), t(`reports.forms.generateReport.fields.comparisonOptions.${({ none: "none", previous_period: "previousPeriod", previous_year: "previousYear" } as Record<string, string>)[String(report.comparisonMode)] ?? "unknown"}`, { defaultValue: t("reports.workspace.unknown") })],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
      </dl>
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {reportTag(report.state) === "draft" ? <p role="status" className="text-sm text-muted-foreground">{t("reports.workspace.draft")}</p> : children}
    </> : null}
  </section>
}
