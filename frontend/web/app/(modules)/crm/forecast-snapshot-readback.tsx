"use client"

import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"
import { useTranslation } from "@lumiere/i18n"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { latestCompanyForecast } from "./forecast-snapshot-model"

export function ForecastSnapshotReadback({ companyId, rows, state, saving }: {
  companyId: bigint
  rows: readonly QueryRowFor<"crm-forecast-snapshots">[]
  state: ModuleDataState
  saving: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? undefined
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
  function date(value: unknown) {
    const micros = stbTimestampMicros(value)
    const timestamp = micros === null ? NaN : new Date(Number(micros / 1000n)).getTime()
    return Number.isFinite(timestamp) ? dates.format(timestamp) : "—"
  }

  const snapshot = state.status === "ready" ? latestCompanyForecast(rows, companyId) : undefined
  return (
    <section aria-label={t("crm.dashboard.forecastSnapshot", "Last forecast")} className="space-y-2 rounded-md border p-4 text-sm" data-testid="crm-forecast-readback">
      <h3 className="font-medium">{t("crm.dashboard.forecastSnapshot", "Last forecast")}</h3>
      {saving ? <p role="status">{t("crm.dashboard.forecastSaving", { defaultValue: "Saving forecast snapshot…" })}</p> : null}
      {state.status === "loading" ? <p role="status">{t("common.loading")}</p> : <ModuleDataNotice state={state} />}
      {snapshot ? (
        <dl className="grid grid-cols-2 gap-2 tabular-nums">
          <dt>{t("crm.dashboard.forecastPeriod", { defaultValue: "Snapshot period" })}</dt>
          <dd>{date(snapshot.periodStart)} – {date(snapshot.periodEnd)}</dd>
          <dt>{t("crm.dashboard.forecastCaptured", { defaultValue: "Captured" })}</dt>
          <dd>{date(snapshot.createdAt)}</dd>
          <dt>{t("crm.dashboard.openOpportunities")}</dt>
          <dd>{typeof snapshot.openCount === "number" ? amount.format(snapshot.openCount) : "—"}</dd>
          <dt>{t("crm.dashboard.forecastStoredWeight", { defaultValue: "Weighted pipeline (currency unspecified)" })}</dt>
          <dd>{typeof snapshot.weightedPipeline === "number" ? amount.format(snapshot.weightedPipeline) : "—"}</dd>
        </dl>
      ) : state.status === "ready" && (
        <p className="text-muted-foreground">{t("crm.dashboard.forecastEmpty", { defaultValue: "No forecast snapshots for this company." })}</p>
      )}
    </section>
  )
}
