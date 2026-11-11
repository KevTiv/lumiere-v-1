"use client"

import { useEffect, useState } from "react"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { KpiStrip } from "@lumiere/ui/components/kpi-strip"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { resolveStoredDashboard } from "@lumiere/ui/lib/stored-dashboard-resolver"
import { DashboardWidgetRenderer } from "@lumiere/ui/pages/dashboard-widget-renderer"
import { opportunityKpis } from "../../../../app/(modules)/crm/opportunity-kpis"
import { TaskSummary } from "../../../../app/(modules)/tasks/task-summary"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"

const currencies = [
  { id: 1, code: "EUR", decimalPlaces: 2 },
  { id: 2, code: "USD", decimalPlaces: 2 },
]
const binding = JSON.stringify({ version: 1, timeField: null, measureField: "amount_total", missingTimestampPolicy: "reject", missingMeasurePolicy: "reject" })
const savedWidget = { id: 1, name: "Saved order value", widgetType: "Kpi", model: "sale_order", fields: ["amount_total"], aggregation: "sum", configuration: binding, isActive: true }
const taskItems = [{ columnId: "InProgress", isClosed: false, dueAt: 1 }, { columnId: "Done", isClosed: true, dueAt: 1 }]

function Preview() {
  const { t } = useTranslation()
  const [hydrated, setHydrated] = useState(false)
  const [status, setStatus] = useState<ModuleDataState["status"]>("ready")
  const [missing, setMissing] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [currencyUnavailable, setCurrencyUnavailable] = useState(false)
  const [aggregation, setAggregation] = useState("sum")
  useEffect(() => setHydrated(true), [])
  const currencyState: ModuleDataState = { status: currencyUnavailable ? "denied" : "ready" }
  const opportunities = empty ? [] : [
    { id: 1, expectedRevenue: missing ? undefined : 100.25, companyCurrencyId: 1, isWon: false, isLost: false, dateDeadline: null },
    { id: 2, expectedRevenue: 200.50, companyCurrencyId: 2, isWon: false, isLost: false, dateDeadline: null },
  ]
  const tiles = opportunityKpis(opportunities, { t, now: new Date("2026-11-10T12:00:00Z"), locale: "en-US", currencyRows: currencies, sourceState: { status }, currencyState })
  const resolution = resolveStoredDashboard([
    { ...savedWidget, aggregation },
    { ...savedWidget, id: 2, name: "Saved order count", fields: ["id"], aggregation: "count" },
  ], [1, 2], {
    sale_order: empty ? [] : [{ id: 1, amount_total: missing ? undefined : 100.25, currency_id: 1 }, { id: 2, amount_total: 200.50, currency_id: 2 }],
    currency: currencies,
  }, { sourceStates: { sale_order: { status: empty ? "empty" : "ready", rowCount: empty ? 0 : 2 }, currency: { status: currencyUnavailable ? "denied" : "ready", rowCount: currencies.length } } })
  return <main className="mx-auto max-w-5xl space-y-6 p-6" data-testid="kpi-integrity" data-hydrated={hydrated}>
    <p>Synthetic KPI integrity preview. Production calculations and components; no ERP API calls.</p>
    <div className="flex flex-wrap gap-4">
      <label>Source state <select aria-label="Source state" value={status} onChange={(event) => setStatus(event.target.value as ModuleDataState["status"])}>{["ready", "loading", "denied", "error", "partial"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Aggregation <select aria-label="Aggregation" value={aggregation} onChange={(event) => setAggregation(event.target.value)}>{["sum", "average", "min", "max"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={missing} onChange={(event) => setMissing(event.target.checked)} /> Missing amount</label>
      <label><input type="checkbox" checked={empty} onChange={(event) => setEmpty(event.target.checked)} /> Empty records</label>
      <label><input type="checkbox" checked={currencyUnavailable} onChange={(event) => setCurrencyUnavailable(event.target.checked)} /> Currency denied</label>
    </div>
    <section aria-label="CRM list KPIs"><KpiStrip tiles={tiles.map((tile) => ({ ...tile, active: false }))} /></section>
    <section aria-label="Saved dashboard KPIs">{resolution.widgets.map((widget) => <div key={widget.id} data-testid={`saved-result-${widget.id}`}><DashboardWidgetRenderer widget={widget} widthClass="w-full" /></div>)}</section>
    <TaskSummary items={empty ? [] : taskItems} state={{ status }} nowMs={100} />
  </main>
}

export default function Page() {
  return <I18nProvider language="en"><ThemeProvider defaultTheme="light" storageKey="kpi-integrity-fixture"><Preview /></ThemeProvider></I18nProvider>
}
