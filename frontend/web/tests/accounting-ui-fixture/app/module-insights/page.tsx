"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ModuleView } from "../../../../../packages/ui/src/pages/module-view"
import { Button } from "../../../../../packages/ui/src/components/button"
import type { ModuleConfig } from "../../../../../packages/ui/src/lib/module-types"
import type { DashboardSection } from "../../../../../packages/ui/src/lib/dashboard-types"
import type { ModuleDataState } from "../../../../../packages/ui/src/lib/module-data-state"
import { ModuleInsights, type InsightPeriodRange } from "../../../../components/module-insights"
import { insightDefinitions, type InsightModule } from "../../../../lib/module-insights-model"
import { moduleInsightNow, moduleInsightRows } from "../../module-insights-fixtures"

function Preview() {
  const [hydrated, setHydrated] = useState(false)
  const [module, setModule] = useState<InsightModule>("sales")
  const [companyId, setCompanyId] = useState(1n)
  const [sourceState, setSourceState] = useState<ModuleDataState["status"]>("ready")
  const [currencyDenied, setCurrencyDenied] = useState(false)
  const [tab, setTab] = useState("dashboard")
  const [message, setMessage] = useState("")
  const [longNames, setLongNames] = useState(false)
  const [periodRange, setPeriodRange] = useState<InsightPeriodRange | null>(null)
  const { setTheme, setPalette } = useTheme()
  useEffect(() => setHydrated(true), [])
  const sections: DashboardSection[] = [{ id: "synthetic-actions", widgets: [{ id: "synthetic-quick-actions", type: "quick-actions", title: "Synthetic retained actions", width: "full", data: { columns: 2, actions: [{ id: "synthetic-create", label: "Synthetic existing create action", icon: "plus", color: "blue", onClick: () => setMessage("Synthetic existing create opened") }] } }] }]
  const mainTab = insightDefinitions[module].tab
  const config: ModuleConfig = { id: module, title: module.toUpperCase(), defaultTab: "dashboard", tabs: [
    { id: "dashboard", label: "Overview", type: "dashboard", sections: [{ id: "legacy", widgets: [{ id: "legacy-dollar-total", type: "stat-cards", title: "LEGACY FIGURES MUST NOT RENDER", width: "full", data: { stats: [{ label: "Mixed currency total", value: "$999999" }] } }] }] },
    { id: mainTab, label: "Existing records workspace", type: "custom", customContent: <p>Original record workspace remains available.</p> },
  ] }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 sm:p-6">
    <p data-testid="module-insights-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic module dashboard preview — no authentication or ERP API operations.</p>
    <div className="flex flex-wrap gap-3">
      <label className="text-xs">Synthetic module<select aria-label="Synthetic module" value={module} onChange={(event) => { setModule(event.target.value as InsightModule); setTab("dashboard"); setCompanyId(1n); setSourceState("ready"); setCurrencyDenied(false) }} className="ml-2 h-11 rounded-md border bg-background px-2">{["sales", "crm", "purchasing", "expenses", "reports"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs">Synthetic source<select aria-label="Synthetic source" value={sourceState} onChange={(event) => setSourceState(event.target.value as ModuleDataState["status"])} className="ml-2 h-11 rounded-md border bg-background px-2">{["ready", "loading", "denied", "error", "partial"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <Button variant="outline" onClick={() => setCompanyId((value) => value === 1n ? 2n : 1n)}>Switch synthetic company</Button>
      <Button variant="outline" onClick={() => setCurrencyDenied((value) => !value)}>Toggle synthetic currency access</Button>
      <Button variant="outline" onClick={() => setLongNames((value) => !value)}>Toggle synthetic long names</Button>
      <Button variant="outline" onClick={() => setTheme("dark")}>Synthetic dark theme</Button>
      <Button variant="outline" onClick={() => setPalette("ocean")}>Synthetic Ocean palette</Button>
    </div>
    <p role="status" data-testid="module-insights-fixture-action">{message}</p>
    <p className="text-xs text-muted-foreground" data-testid="module-insights-period-callback">{periodRange ? `${new Date(periodRange.startMs).toISOString()} – ${new Date(periodRange.endMs).toISOString()}` : "Pending period"}</p>
    <ModuleView config={config} activeTab={tab} onActiveTabChange={setTab} dashboardTimeRange="30d" onDashboardTimeRangeChange={() => {}} dashboardContent={<ModuleInsights input={{ module, organizationId: 1, companyId, records: { rows: moduleInsightRows(module).map((row) => longNames && row.id === "101" ? { ...row, name: `Synthetic international ${"LongReference".repeat(20)}` } : row), state: { status: sourceState } }, currencies: { rows: [{ id: 1, code: "EUR", decimalPlaces: 2 }, { id: 2, code: "USD", decimalPlaces: 2 }], state: { status: currencyDenied ? "denied" : "ready" } } }} sections={sections} now={moduleInsightNow} onPeriodRangeChange={setPeriodRange} />} />
  </main>
}
export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false }}><ThemeProvider defaultTheme="light" storageKey="lumiere-module-insights-preview"><Preview /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
