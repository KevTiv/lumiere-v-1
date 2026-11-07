"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { ImportTaskExecutionPanel } from "../../../../lib/import-task-execution-panel"

const api = createLumiereApiClient({ baseUrl: "" })

/** Production execution component with synthetic HTTP, never a live ERP proof. */
export default function Page() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const [companyId, setCompanyId] = useState(9001)
  const [view, setView] = useState<"preview" | "results">("preview")
  return (
    <QueryClientProvider client={client}>
      <LumiereApiProvider client={api}>
        <ErpSessionProvider
          value={{
            identity: "ab".repeat(32),
            connected: true,
            organizationId: 8001,
            companyIds: [companyId],
          }}
        >
          <I18nProvider language="en">
            <ThemeProvider defaultTheme="light">
              <main className="space-y-4 p-6">
                <p>
                  Synthetic import execution fixture. Simulated receipts; no
                  live ERP writes.
                </p>
                <button type="button" onClick={() => setCompanyId(9002)}>
                  Change company
                </button>{" "}
                <button
                  type="button"
                  onClick={() =>
                    setView(view === "preview" ? "results" : "preview")
                  }
                >
                  Switch import view
                </button>
                <ImportTaskExecutionPanel
                  organizationId={8001}
                  companyId={companyId}
                  taskId={"a".repeat(32)}
                  reviewId="71"
                  view={view}
                />
              </main>
            </ThemeProvider>
          </I18nProvider>
        </ErpSessionProvider>
      </LumiereApiProvider>
    </QueryClientProvider>
  )
}
