"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { ModuleView } from "@lumiere/ui/pages/module-view"
import { Button } from "@lumiere/ui/components/button"
import { FormModal } from "@lumiere/ui/forms/form-modal"
import { newFinancialReportForm } from "@lumiere/ui/lib/reports-form-configs"
import { mergeFieldDefaultValues, mergeSelectOptionsForFields } from "@lumiere/ui/lib/form-config-merge"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { businessWorkspaceNavigation } from "../../../../lib/business-workspace-navigation"
import type { ModuleConfig } from "@lumiere/ui/lib/module-types"
import { ModuleInsights } from "../../../../components/module-insights"
import { ReportStart, ReportResult } from "../../../../app/(modules)/reports/report-workspace"
import { selectedReport, reportCanDownload, type ReportRow } from "../../../../app/(modules)/reports/report-workspace-model"

const first: ReportRow = { id: "9007199254740993", name: "October trial balance", companyId: "1", organizationId: "1", createDate: "2026-10-01", dateFrom: "2026-10-01", dateTo: "2026-10-31", currencyId: "1", targetMove: "posted", comparisonMode: "previous_period", state: "generated" }
const storageKey = "synthetic-reports-workspace"

function Preview() {
  const { t } = useTranslation()
  const params = useSearchParams()
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [rows, setRows] = useState<ReportRow[]>([first])
  const [formType, setFormType] = useState<string | null>(null)
  const [reject, setReject] = useState(false)
  const [source, setSource] = useState<ModuleDataState["status"]>("ready")
  const [downloaded, setDownloaded] = useState(false)
  useEffect(() => { const raw = sessionStorage.getItem(storageKey); if (raw) setRows(JSON.parse(raw) as ReportRow[]); setHydrated(true) }, [])
  const state: ModuleDataState = source === "error" ? { status: "error", onRetry: () => setSource("ready") } : { status: source }
  const before = params.get("before") === "1"
  const readOnly = params.get("readOnly") === "1"
  const id = params.get("report")
  const report = selectedReport(rows, id)
  const base: ModuleConfig = {
    id: "reports", title: "Reports", description: "Financial reports, templates, schedules, and metrics", defaultTab: "dashboard",
    workspaceNav: businessWorkspaceNavigation("reports", t),
    tabs: [
      { id: "dashboard", label: before ? "Dashboard" : t("reports.workspace.catalog"), type: "dashboard", sections: [{ id: "rep-quick-actions-section", widgets: [{ id: "rep-quick-actions", type: "quick-actions", title: "Quick actions", width: "full", data: { columns: 6, actions: [
        { id: "generate_report", label: "Generate report", icon: "plus", color: "purple" },
        { id: "new_template", label: "New template", icon: "template", color: "blue" },
        { id: "schedule_report", label: "Schedule report", icon: "calendar", color: "teal" },
        { id: "new_metric", label: "New metric", icon: "gauge", color: "orange" },
        { id: "new_dashboard", label: "New dashboard", icon: "layout", color: "green" },
        { id: "new_widget", label: "New widget", icon: "widget", color: "purple" },
      ] } }] }] },
      ...[["owner-reports", "Owner reports"], ["reports", "Financial reports"], ["statements", "Statements"], ["trial-balance", "Trial balance"], ["vat-report", "VAT report"], ["report-templates", "Report templates"], ["scheduled-reports", "Scheduled reports"], ["analytics-metrics", "Analytics metrics"], ["dashboards", "Dashboards"], ["dashboard-widgets", "Dashboard widgets"], ["pivot-explorer", "Pivot explorer"], ["query-builder", "Query builder"]].map(([id, label]) => ({ id: id!, label: label!, type: "custom" as const })),
    ],
  }
  const open = (reportId: string) => router.push(`/reports-workspace?tab=reports&report=${reportId}`)
  const config = { ...base, tabs: base.tabs.map((tab) => tab.id === "reports" ? { ...tab, type: "custom" as const, customContent: id
    ? <ReportResult report={report} sourceState={state} companyLabel="Synthetic Alpha Ltd" currencyLabel="Euro (EUR)" onBack={() => router.push("/reports-workspace?tab=reports")} actions={report && !readOnly && reportCanDownload(report) ? <Button onClick={() => setDownloaded(true)}>Export CSV</Button> : undefined}>
        <p data-testid="synthetic-report-output">Saved output for {String(report?.name)}: 125.00 EUR</p>
      </ReportResult>
    : <section className="space-y-3"><h2 className="text-xl font-semibold">Saved reports</h2>{rows.map((row) => <div key={String(row.id)}><Button variant="link" onClick={() => open(String(row.id))}>{String(row.name)}</Button></div>)}</section> } : tab) }
  if (before) config.workspaceNav = { label: "Workspace", overflowLabel: "Advanced", workspaces: [
    { id: "overview", label: "Overview", tabIds: ["dashboard", "owner-reports"] },
    { id: "financial", label: "Financial", tabIds: ["reports", "statements", "trial-balance", "vat-report"] },
    { id: "analytics", label: "Analytics", tabIds: ["dashboards", "dashboard-widgets", "pivot-explorer", "analytics-metrics", "query-builder"] },
    { id: "schedules", label: "Schedules", tabIds: ["scheduled-reports"] },
  ], overflow: [{ id: "configuration", label: "Configuration", tabIds: ["report-templates"] }] }
  const form = mergeFieldDefaultValues(mergeSelectOptionsForFields(newFinancialReportForm(t), { currencyId: [{ value: "1", label: "Euro (EUR)" }] }), { reportType: formType ?? "trialBalance", targetMove: "posted", currencyId: "1" })
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 sm:p-6">
    <p data-testid="reports-fixture-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic Reports UI preview. Saves use session storage; no ERP operations or authentication.</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setReject((value) => !value)}>{reject ? "Allow synthetic save" : "Reject synthetic save"}</Button><Button variant="outline" onClick={() => setSource("error")}>Fail synthetic source</Button><Button variant="outline" onClick={() => setSource("denied")}>Deny synthetic source</Button><Button variant="outline" onClick={() => setSource("loading")}>Load synthetic source</Button></div>
    {downloaded && <p role="status">Synthetic CSV requested</p>}
    <ModuleView config={config} dashboardContent={before
      ? <ModuleInsights input={{ module: "reports", organizationId: 1, companyId: 1n, records: { rows, state }, currencies: { rows: [{ id: 1, code: "EUR", decimalPlaces: 2 }], state: { status: "ready" } } }} sections={base.tabs[0]!.sections ?? []} now={new Date("2026-10-28T12:00:00Z")} />
      : <ReportStart sourceState={state} reportTypes={params.get("locked") === "1" ? ["trialBalance"] : undefined} canGenerate={!readOnly} onGenerate={setFormType}><details><summary className="cursor-pointer py-3 text-sm font-medium">{t("reports.workspace.overview")}</summary><ModuleInsights input={{ module: "reports", organizationId: 1, companyId: 1n, records: { rows, state }, currencies: { rows: [{ id: 1, code: "EUR", decimalPlaces: 2 }], state: { status: "ready" } } }} sections={[]} now={new Date("2026-10-28T12:00:00Z")} /></details></ReportStart>} />
    <FormModal open={formType != null} onOpenChange={(value) => { if (!value) setFormType(null) }} config={form} onSubmit={async (values) => {
      if (reject) { setReject(false); throw new Error("Synthetic generation rejected; entered values retained") }
      const created = { ...values, id: "9007199254740995", organizationId: "1", companyId: "1", state: "generated" }
      const saved = [...rows.filter((row) => row.id !== created.id), created]
      sessionStorage.setItem(storageKey, JSON.stringify(saved)); setRows(saved); setFormType(null); open(created.id)
    }} />
  </main>
}

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false }}><ThemeProvider defaultTheme="light"><Preview /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
