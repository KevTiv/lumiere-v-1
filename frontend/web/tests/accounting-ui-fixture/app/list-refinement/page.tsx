"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { DashboardWorkspace } from "../../../../../packages/ui/src/pages/dashboard-workspace"
import { DashboardSidebar } from "../../../../../packages/ui/src/pages/dashboard-sidebar"
import { EntityRecordSheet } from "../../../../../packages/ui/src/entity-views/entity-record-sheet"
import { useModuleUrlFilters, useClearModuleUrlFilter } from "../../../../../packages/ui/src/lib/module-url-filters"
import { returnJourneyRows, returnJourneyScope } from "../../return-navigation-fixtures"
import { Button } from "../../../../../packages/ui/src/components/button"
import { BillsListView } from "../../../../../packages/ui/src/accounting-components/bills-list-view"
import { InvoiceListView } from "../../../../../packages/ui/src/accounting-components/invoice-list-view"
import { workflowBills, workflowCurrencies, workflowInvoices } from "../../workflow-fixtures"

const intakeBills = [
  ...workflowBills,
  ...Array.from({ length: 20 }, (_, index) => ({
    ...workflowBills[1]!, id: String(300 + index), name: `BILL/SYNTHETIC/INTAKE-${index + 1}`,
  })),
]

function ListRefinement() {
  const searchParams = useSearchParams()
  const returnJourney = searchParams.get("journey") === "return"
  const routeFilters = useModuleUrlFilters()
  const clearRouteFilter = useClearModuleUrlFilter()
  const [previewRecord, setPreviewRecord] = useState<Record<string, unknown> | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [linkedFilters, setLinkedFilters] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState("")
  const [showBills, setShowBills] = useState(false)
  useEffect(() => { setShowBills(new URLSearchParams(window.location.search).get("view") === "bills"); setHydrated(true) }, [])
  return <DashboardWorkspace sidebar={<DashboardSidebar userProfile={{ name: "Synthetic Accountant" }} />} onOpenSearch={() => {}}>
    <p className="mb-4 text-xs text-muted-foreground" data-testid="list-refinement-disclosure" data-hydrated={hydrated}>Synthetic invoice list — no ERP backend operations</p>
    <h1 className="mb-4 text-2xl font-semibold">Accounting</h1>
    {showBills ? <BillsListView
      bills={intakeBills}
      currencyOptions={workflowCurrencies}
      worklistScope={returnJourneyScope}
      sourceState={{ status: "ready" }}
      intake={{ lines: [], sourceState: { status: "ready" } }}
      onSelectBill={(bill) => setSelected(String(bill.id))}
      onCreateBill={() => setSelected("new bill draft requested")}
    /> : <InvoiceListView
      invoices={returnJourney ? returnJourneyRows : workflowInvoices}
      currencyOptions={workflowCurrencies}
      worklistScope={returnJourneyScope}
      sourceState={{ status: "ready" }}
      initialFilters={returnJourney ? routeFilters : linkedFilters}
      onInitialFilterClear={returnJourney ? clearRouteFilter : (key) => setLinkedFilters((current) => key === "*" ? {} : Object.fromEntries(Object.entries(current).filter(([field]) => field !== key)))}
      onSelectInvoice={(invoice) => { setSelected(String(invoice.id)); if (returnJourney) setPreviewRecord({ ...invoice }) }}
      onCreateInvoice={() => setSelected("new draft requested")}
    />}
    {returnJourney ? <EntityRecordSheet
      open={previewRecord !== null}
      onOpenChange={(open) => { if (!open) setPreviewRecord(null) }}
      record={previewRecord}
      config={{
        titleKey: "name",
        openHref: (record) => `/accounting/invoices/${String(record.id)}`,
        detailConfig: { mode: "detail", sections: [{ id: "document", fields: [
          { key: "name", label: "Document" }, { key: "invoicePartnerDisplayName", label: "Customer" },
        ] }] },
      }}
    /> : null}
    <section className="mt-6 space-y-3" aria-label="Synthetic linked filter controls">
      <Button variant="outline" onClick={() => setLinkedFilters({ currencyId: "1" })}>Apply linked EUR filter</Button>
      <output data-testid="list-refinement-selection" className="block">{selected || "No synthetic preview selected"}</output>
    </section>
  </DashboardWorkspace>
}

export default function ListRefinementFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><ListRefinement /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
