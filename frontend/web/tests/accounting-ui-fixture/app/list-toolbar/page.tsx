"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { WorkspaceProfileProvider } from "../../../../../packages/ui/src/lib/workspace-profile-context"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { EntityView } from "../../../../../packages/ui/src/entity-views/entity-view"
import { withReadOnlyStateBoard } from "../../../../../packages/ui/src/lib/entity-state-board"
import { InvoiceListView } from "../../../../../packages/ui/src/accounting-components/invoice-list-view"
import { BillsListView } from "../../../../../packages/ui/src/accounting-components/bills-list-view"
import { workflowInvoices, workflowBills, workflowCurrencies } from "../../workflow-fixtures"
import { returnJourneyScope } from "../../return-navigation-fixtures"

const rows = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `Synthetic order ${index + 1}`, state: index % 2 ? "Draft" : "Confirmed", amount: index + 1 }))

function ToolbarExamples() {
  const { t } = useTranslation()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const config = withReadOnlyStateBoard(t, {
    id: "toolbar-example", title: "Synthetic orders", view: {
      mode: "table", listViewKey: "toolbar-example", rowKey: "id", searchable: true, selectable: true,
      searchKeys: ["name"], allowExport: true,
      filters: [{ key: "state", label: "Status", type: "select", options: [{ value: "Draft", label: "Draft" }, { value: "Confirmed", label: "Confirmed" }] }],
      columns: [
        { key: "name", label: "Order", sortable: true },
        { key: "state", label: "Status", type: "badge", badgeLabels: { Draft: "Draft", Confirmed: "Confirmed" } },
        { key: "amount", label: "Amount", type: "number", sortable: true },
      ],
    },
  }, { groupKey: "state", card: { titleKey: "name" }, pivot: { groupKeys: ["state"], measureKeys: ["amount"] } })
  return <main className="mx-auto min-w-0 max-w-6xl space-y-8 p-4 sm:p-6">
    <p data-testid="toolbar-disclosure" data-hydrated={hydrated}>Synthetic toolbar comparison; no ERP backend operations.</p>
    <section aria-label="Generic records"><EntityView config={config} data={rows} useCard={false} /></section>
    <section aria-label="Customer invoices"><InvoiceListView invoices={workflowInvoices} worklistScope={returnJourneyScope} sourceState={{ status: "ready" }} currencyOptions={workflowCurrencies} /></section>
    <section aria-label="Vendor bills"><BillsListView bills={workflowBills} worklistScope={returnJourneyScope} sourceState={{ status: "ready" }} currencyOptions={workflowCurrencies} /></section>
  </main>
}

export default function ListToolbarFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><WorkspaceProfileProvider value="finance-alpha"><ThemeProvider defaultTheme="light"><ToolbarExamples /></ThemeProvider></WorkspaceProfileProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
