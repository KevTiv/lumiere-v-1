"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createLumiereApiClient, LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { ImportJobPageClient } from "../../../../app/(modules)/settings/import-jobs/[id]/import-job-page-client"

const api = createLumiereApiClient({ baseUrl: "" })

export default function ImportJobReadbackFixture() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )

  return (
    <QueryClientProvider client={client}>
      <LumiereApiProvider client={api}>
        <ErpSessionProvider
          value={{
            identity: "ab".repeat(32),
            connected: true,
            organizationId: 8001,
            companyIds: [9001],
          }}
        >
          <I18nProvider language="en">
            <ImportJobPageClient organizationId={8001} jobId="9007199254740993" />
          </I18nProvider>
        </ErpSessionProvider>
      </LumiereApiProvider>
    </QueryClientProvider>
  )
}
