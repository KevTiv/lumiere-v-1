"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ModuleView } from "../../../../../packages/ui/src/pages/module-view"
import { Button } from "../../../../../packages/ui/src/components/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../packages/ui/src/components/tabs"
import { WorkspaceTabsList, WorkspaceTabsTrigger } from "../../../../../packages/ui/src/components/workspace-tabs"
import type { ModuleConfig, ModuleWorkspaceNav } from "../../../../../packages/ui/src/lib/module-types"
import { businessWorkspaceNavigation, type BusinessWorkspaceModule } from "../../../../lib/business-workspace-navigation"
import { accountingWorkspaceNavigation } from "../../../../lib/accounting-workspace-navigation"
import { useModuleTab } from "../../../../hooks/use-module-tab"

const modules = ["accounting", "sales", "crm", "purchasing", "reports", "expenses", "documents", "calendar", "messages", "uncurated"] as const
function Preview() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useSearchParams()
  const selected = params.get("module") ?? "sales"
  const module = modules.find((id) => id === selected) ?? "sales"
  const [hydrated, setHydrated] = useState(false)
  const [longNames, setLongNames] = useState(false)
  const [localTab, setLocalTab] = useState("register")
  const { setTheme, setPalette } = useTheme()
  useEffect(() => setHydrated(true), [])
  const nav: ModuleWorkspaceNav | undefined = module === "uncurated" ? undefined : module === "accounting"
    ? accountingWorkspaceNavigation(t) : businessWorkspaceNavigation(module as BusinessWorkspaceModule, t)
  const ids = nav ? [...nav.workspaces, ...(nav.overflow ?? [])].flatMap((group) => group.tabIds) : ["dashboard", ...Array.from({ length: 9 }, (_, index) => `records-${index}`)]
  const defaultTab = params.get("defaultTab") === "orders" ? "orders" : module === "documents" ? "documents" : module === "calendar" ? "calendar" : module === "messages" ? "messages" : "dashboard"
  const config: ModuleConfig = {
    id: module, title: module, defaultTab,
    workspaceNav: nav && { ...nav, workspaces: nav.workspaces.map((group) => ({ ...group, label: longNames ? `${group.label} ${"InternationalWorkspace".repeat(8)}` : group.label })) },
    tabs: [...ids, "future-extension"].map((id) => ({ id, label: id, type: "custom", customContent: <>
      <p data-testid="navigation-content">{id} content — synthetic data only.</p>
      {id === "dashboard" && <Tabs defaultValue="summary">
        <TabsList aria-label="Synthetic chart views">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="trend" data-testid="fixture-chart-trend">Trend</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">Synthetic chart summary</TabsContent>
        <TabsContent value="trend" data-testid="fixture-chart-trend-panel">Synthetic chart trend</TabsContent>
      </Tabs>}
    </> })),
  }
  const { activeTab, setActiveTab } = useModuleTab(defaultTab, config.tabs.map((tab) => tab.id))
  return <main className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 sm:p-6">
    <p data-testid="navigation-disclosure" data-hydrated={hydrated}>Synthetic navigation preview — no authentication or ERP operations.</p>
    <div className="flex flex-wrap gap-3">
      <label>Module<select aria-label="Module" value={module} className="ml-2 min-h-11 border bg-background" onChange={(event) => router.push(`/navigation?module=${event.target.value}&company=7`)}>{modules.map((id) => <option key={id}>{id}</option>)}</select></label>
      <Button onClick={() => setLongNames((value) => !value)}>Toggle long labels</Button>
      <Button onClick={() => { setTheme("dark"); setPalette("ocean") }}>Dark Ocean appearance</Button>
    </div>
    <ModuleView key={module} config={config} activeTab={activeTab} onActiveTabChange={setActiveTab} />
    <section data-testid="local-module-shell" aria-label="Synthetic compact module shell">
      <Tabs value={localTab} onValueChange={setLocalTab}>
        <WorkspaceTabsList aria-label="Local module workspaces">
          <WorkspaceTabsTrigger value="register">Register</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="admin">Administration</WorkspaceTabsTrigger>
        </WorkspaceTabsList>
        <TabsContent value="register">Synthetic register</TabsContent>
        <TabsContent value="admin">Synthetic administration</TabsContent>
      </Tabs>
    </section>
  </main>
}

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false }}><ThemeProvider defaultTheme="light" storageKey="lumiere-navigation-preview"><Preview /></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
