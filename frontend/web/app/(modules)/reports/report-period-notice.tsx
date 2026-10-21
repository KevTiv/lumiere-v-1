"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import type { PeriodReportContext } from "@lumiere/ui/lib/period-report-context"

export function ReportPeriodNotice({ state, context }: { state: ModuleDataState; context: PeriodReportContext | null }) {
  const { t } = useTranslation()
  return <div className="m-4 space-y-3 rounded-lg border p-4" role={state.status === "error" || state.status === "partial" ? "alert" : "status"} data-testid="report-period-context">
    <p className="font-medium">{t("reports.periodContext.title", { defaultValue: "Period close report review" })}</p>
    {state.status === "ready" && context ? <p className="text-sm">{t("reports.periodContext.scope", { defaultValue: "Company {{company}} · period {{period}} · {{from}} to {{to}}. Report results and new report dates use this exact period.", company: context.companyId, period: context.periodId, from: context.dateFrom.slice(0, 10), to: context.dateTo.slice(0, 10) })}</p> : <p className="text-sm">{state.status === "loading" ? t("reports.periodContext.loading", { defaultValue: "Checking period ownership and report sources…" }) : state.status === "denied" ? t("reports.periodContext.denied", { defaultValue: "You do not have access to the period or report sources needed for this review." }) : t("reports.periodContext.unavailable", { defaultValue: "The period context or its source records could not be verified. Return to period close, select the active company and period, and retry." })}</p>}
    <div className="flex flex-wrap gap-3">
      <a className="text-sm text-primary underline" href="/accounting?tab=period-close">{t("reports.periodContext.returnToClose", { defaultValue: "Return to period close" })}</a>
      <a className="text-sm text-primary underline" href="/reports?tab=reports">{t("reports.periodContext.clear", { defaultValue: "View all reports" })}</a>
      {"onRetry" in state && state.onRetry ? <Button type="button" variant="outline" size="sm" onClick={state.onRetry}>{t("common.retry", { defaultValue: "Retry" })}</Button> : null}
    </div>
  </div>
}
