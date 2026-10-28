"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../../../../packages/ui/src/components/theme-provider"
import { DashboardWorkspace } from "../../../../../../../packages/ui/src/pages/dashboard-workspace"
import { DashboardSidebar } from "../../../../../../../packages/ui/src/pages/dashboard-sidebar"
import { RecordPage } from "../../../../../../../packages/ui/src/entity-views/record-page"
import { readRecordListReturnContext } from "../../../../../../../packages/ui/src/lib/record-list-context"
import { accountingWorklistKey } from "../../../../../../../packages/ui/src/accounting-components/accounting-worklist-model"
import { returnJourneyRows, returnJourneyScope } from "../../../../return-navigation-fixtures"

function ReturnRecord({ recordId }: { recordId: string }) {
  const [returnHref, setReturnHref] = useState("/accounting?tab=invoices")
  const [hydrated, setHydrated] = useState(false)
  const record = returnJourneyRows.find((row) => String(row.id) === recordId)
  useEffect(() => {
    const key = accountingWorklistKey(returnJourneyScope, "invoice")
    const context = key ? readRecordListReturnContext("/accounting/invoices", { key, recordId }) : undefined
    if (context) setReturnHref(context.href)
    setHydrated(true)
  }, [recordId])
  return <DashboardWorkspace sidebar={<DashboardSidebar userProfile={{ name: "Synthetic Accountant" }} />} onOpenSearch={() => {}}>
    <p data-testid="return-record-ready" data-hydrated={hydrated} className="mb-4 text-xs text-muted-foreground">Synthetic record navigation — no ERP API operations</p>
    <RecordPage
      testIdPrefix="invoice"
      title={record?.name ?? "Synthetic record unavailable"}
      subtitle={record?.invoicePartnerDisplayName}
      breadcrumbs={[
        { label: "Accounting", href: "/accounting" },
        { label: "Invoices", href: returnHref },
        { label: record?.name ?? recordId },
      ]}
      activeTab="details"
      onTabChange={() => {}}
      tabs={[{ id: "details", label: "Saved details", content: <p data-testid="return-record-id">Exact synthetic record ID: {recordId}</p> }]}
    />
  </DashboardWorkspace>
}

export default function ReturnRecordFixture({ recordId }: { recordId: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><ReturnRecord recordId={recordId} /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
