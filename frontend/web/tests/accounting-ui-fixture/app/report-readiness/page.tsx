"use client"
import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider } from "@lumiere/i18n"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ReportAnalysisPanel } from "../../../../app/(modules)/ai-harness/report-analysis-panel"
const fixtureApi = createLumiereApiClient({ baseUrl: "" })
export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <LumiereApiProvider client={fixtureApi}><QueryClientProvider client={client}><I18nProvider language="en"><main className="p-6"><ReportAnalysisPanel organizationId={11n} companies={[
    { id: "13", name: "Source company" }, { id: "14", name: "Acceptance company" },
  ]} /></main></I18nProvider></QueryClientProvider></LumiereApiProvider>
}
