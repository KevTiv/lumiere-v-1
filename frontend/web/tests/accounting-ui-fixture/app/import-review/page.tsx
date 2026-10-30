"use client"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { ImportReviewPanel } from "../../../../lib/import-review-workspace"

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [result,setResult] = useState("")
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><main className="p-6">
    <p>Synthetic source review fixture. No ERP import commands.</p>
    <ImportReviewPanel organizationId={8001} companyId={9001} initialId="1" onContinue={source => setResult(source.csv)} />
    <output data-testid="reviewed-csv">{result}</output>
  </main></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
