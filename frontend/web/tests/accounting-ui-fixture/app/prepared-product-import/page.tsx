"use client"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { GuidedImportWizard } from "../../../../lib/guided-import-wizard"

const api = createLumiereApiClient({ baseUrl: "" })
export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><LumiereApiProvider client={api}><ErpSessionProvider value={{ identity: "ab".repeat(32), connected: true, organizationId: 8001, companyIds: [9001] }}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><main className="p-6">
    <p>Synthetic prepared product import fixture.</p>
    <GuidedImportWizard organizationId={8001} initialSource={{ targetEntity: "product", fileName: "synthetic-products.csv", csv: "name,category_id,uom_id,uom_po_id,sale_price,cost_price,active\nSynthetic product,12,13,13,4800,3000,false" }} />
  </main></ThemeProvider></RBACProvider></I18nProvider></ErpSessionProvider></LumiereApiProvider></QueryClientProvider>
}
