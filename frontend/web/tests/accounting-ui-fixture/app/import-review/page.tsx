"use client"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { ImportReviewPanel } from "../../../../lib/import-review-workspace"
import { DataImportWorkspace } from "../../../../lib/data-import-workspace"
import { webApi } from "../../../../lib/lumiere-web-http"

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [result,setResult] = useState("")
  const [workspace, setWorkspace] = useState(false)
  return <LumiereApiProvider client={webApi}><QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ErpSessionProvider value={{ identity: null, connected: false, organizationId: 8001, companyIds: [9001] }}><ThemeProvider defaultTheme="light"><main className="p-6">
    <p>Synthetic source review fixture. HTTP responses are simulated; no live ERP effects.</p>
    <button type="button" onClick={() => setWorkspace(true)}>Open import handoff fixture</button>
    {workspace ? <DataImportWorkspace organizationId={8001} /> : <ImportReviewPanel organizationId={8001} companyId={9001} initialId="1" onContinue={source => setResult(source.csv)} />}
    <output data-testid="reviewed-csv">{result}</output>
  </main></ThemeProvider></ErpSessionProvider></RBACProvider></I18nProvider></QueryClientProvider></LumiereApiProvider>
}
