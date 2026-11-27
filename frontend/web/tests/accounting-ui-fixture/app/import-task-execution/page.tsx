"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { importWorkflowKey } from "../../../../lib/use-import-workflow"
import { useSavedImportRuns } from "../../../../lib/use-saved-import-runs"
import { ImportTaskExecutionPanel } from "../../../../lib/import-task-execution-panel"

const api = createLumiereApiClient({ baseUrl: "" })

const identity = "ab".repeat(32)
const taskId = "a".repeat(32)
const organizationId = 8001

// The isolated fixture does not mount the surrounding SavedImportWorkspace.
function RefreshVerifiedProposal({ companyId }: { companyId: number }) {
  const client = useQueryClient()
  const runs = useSavedImportRuns({ identity, organizationId, companyId }, taskId, true)
  const verified = runs.data?.runs.some((run) => run.status === "verified") ?? false
  useEffect(() => {
    if (verified) {
      void client.invalidateQueries({
        queryKey: importWorkflowKey(identity, { organizationId, companyId, taskId }),
      })
    }
  }, [client, companyId, verified])
  return null
}

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
            identity,
            connected: true,
            organizationId,
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
                <RefreshVerifiedProposal companyId={companyId} />
                <ImportTaskExecutionPanel
                  organizationId={organizationId}
                  companyId={companyId}
                  taskId={taskId}
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
