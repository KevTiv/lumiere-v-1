"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { RBACProvider } from "../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../packages/ui/src/components/theme-provider"
import { DashboardSidebar } from "../../../../packages/ui/src/pages/dashboard-sidebar"
import { DashboardWorkspace } from "../../../../packages/ui/src/pages/dashboard-workspace"
import { WorkspaceNav } from "../../../../packages/ui/src/pages/workspace-nav"
import { Tabs, TabsContent } from "../../../../packages/ui/src/components/tabs"
import { Button } from "../../../../packages/ui/src/components/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../packages/ui/src/components/table"
import { CreateInvoiceModal } from "../../../../packages/ui/src/accounting-components/create-invoice-modal"
import { InvoiceDetailModal } from "../../../../packages/ui/src/accounting-components/invoice-detail-modal"
import type { ModuleTab } from "../../../../packages/ui/src/lib/module-types"
import { accountingWorkspaceNavigation } from "../../../lib/accounting-workspace-navigation"
import { AccountantOverview } from "../../../app/(modules)/accounting/accountant-overview"
import { fixtureNow, overviewFixture } from "../fixtures"

function AccountingFixture() {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const { t } = useTranslation()
  const navigation = accountingWorkspaceNavigation(t)
  const tabs: ModuleTab[] = [...navigation.workspaces, ...(navigation.overflow ?? [])].flatMap((workspace) => workspace.tabIds.map((id) => ({ id, label: id === "dashboard" ? "Overview" : id.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "), type: "custom" })))
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [activeTab, setActiveTab] = useState("dashboard")
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [postRequested, setPostRequested] = useState(false)
  const [searched, setSearched] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bankSelection, setBankSelection] = useState("")
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light">
    <DashboardWorkspace sidebar={<DashboardSidebar userProfile={{ name: "Alpha Accountant", email: "accountant@example.test" }} />} onOpenSearch={() => setSearched(true)}>
      <p className="mb-4 text-xs text-muted-foreground" data-testid="fixture-disclosure" data-hydrated={hydrated}>Synthetic UI fixture — no backend operations</p>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Accounting</h1><p className="mt-1 text-sm text-muted-foreground">Financial overview and daily work</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setReviewOpen(true)}>Review invoice</Button><Button onClick={() => { setSaved(false); setInvoiceOpen(true) }}>New invoice</Button></div></div>
      {searched && <p role="status">Search requested</p>}
      {saved && <p role="status">Synthetic draft captured</p>}
      {bankSelection && <p role="status">{bankSelection}</p>}
      {postRequested && <p role="status">Synthetic posting requested</p>}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-col flex">
        <WorkspaceNav moduleId="accounting" tabs={tabs} config={navigation} activeTab={activeTab} onTabChange={setActiveTab} hrefForTab={(id) => `/?tab=${id}`} />
        {tabs.map((tab) => <TabsContent key={tab.id} value={tab.id}>{tab.id === "dashboard"
          ? <AccountantOverview data={overviewFixture} companyName="Lumière Alpha Ltd" now={fixtureNow} onNavigate={setActiveTab} onOpenBankLine={(line, statement) => setBankSelection(`Synthetic bank selection: statement ${String(statement.id)}, line ${String(line.id)}`)} />
          : <section className="mt-5 rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">{tab.label}</h2><p className="mt-2 text-sm text-muted-foreground">Controlled fixture for workspace navigation and responsive layout.</p><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>State</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell data-testid="fixture-density-cell">Synthetic record</TableCell><TableCell>Draft</TableCell></TableRow></TableBody></Table></section>}</TabsContent>)}
      </Tabs>
      <CreateInvoiceModal open={invoiceOpen} companyId={1n} onClose={() => setInvoiceOpen(false)}
        onSave={async () => { setSaved(true); return { kind: "converged", dispatch: "acknowledged", ref: { resource: "account-moves", id: "fixture-only" } } }}
        onCheckStatus={async () => null}
        journalOptions={[{ value: "1", label: "Sales journal", currencyId: "1" }]}
        partnerOptions={[{ value: "2", label: "Acme Corporation" }]}
        counterpartAccountOptions={[{ value: "3", label: "Trade receivables" }]}
        lineAccountOptions={[{ value: "4", label: "Consulting revenue" }]}
        currencyOptions={[{ value: "1", label: "Euro (EUR)", code: "EUR" }]} />
      <InvoiceDetailModal open={reviewOpen} onClose={() => setReviewOpen(false)} currencyCode="EUR" currencyId="1"
        invoice={{ id: 103n, name: "INV/2026/0103", state: { tag: "Draft" }, moveType: { tag: "OutInvoice" }, amountTotal: 1250, amountUntaxed: 1250, amountTax: 0, amountResidual: 1250, invoicePartnerDisplayName: "Acme Corporation" }}
        onPostDraft={() => setPostRequested(true)} />
    </DashboardWorkspace>
  </ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}

export default AccountingFixture
