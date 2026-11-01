"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LumiereApiProvider } from "@lumiere/api-client"
import { ErpSessionProvider } from "@lumiere/erp-session"
import { I18nProvider } from "@lumiere/i18n"
import { AIChatPanel } from "@lumiere/ui"
import { ThemeProvider } from "@lumiere/ui/components/theme-provider"
import { RBACProvider } from "@lumiere/ui/lib/rbac-context"
import { useChatImportTasks } from "../../../../lib/chat-import-tasks"
import { webApi } from "../../../../lib/lumiere-web-http"

function ChatFixture({ identity, companyId }: { identity: string; companyId: number }) {
  const imports = useChatImportTasks({
    identity,
    organizationId: 8001,
    companyId,
    conversationKey: "fixture-import-conversation",
  })
  const [questions, setQuestions] = useState(0)
  return <>
    <output data-testid="chat-text-requests">{questions}</output>
    <AIChatPanel
      open
      docked
      onClose={() => undefined}
      context={{ companyId, currentUser: identity }}
      config={{ enableFileUpload: true }}
      importScopeKey={`${identity}:8001:${companyId}:fixture-import-conversation`}
      importCompanyLabel={`Synthetic farm company ${companyId}`}
      onImportFiles={imports.onImportFiles}
      importTaskContent={imports.content}
      onSendMessage={async () => {
        setQuestions(value => value + 1)
        return { content: "Synthetic chat answer" }
      }}
    />
  </>
}

export default function Page() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [actor, setActor] = useState("ab".repeat(32))
  const [companyId, setCompanyId] = useState(9001)
  return <LumiereApiProvider client={webApi}>
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <RBACProvider useDefaultFixtures>
          <ErpSessionProvider value={{ identity: actor, connected: true, organizationId: 8001, companyIds: [companyId] }}>
            <ThemeProvider defaultTheme="light">
              <main className="h-screen p-4 flex flex-col gap-3">
                <p>Chat import fixture: production components with simulated HTTP. No live ERP effects.</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setCompanyId(9002)}>Change import company</button>
                  <button type="button" onClick={() => setActor("cd".repeat(32))}>Change import actor</button>
                </div>
                <div className="min-h-0 flex-1"><ChatFixture identity={actor} companyId={companyId} /></div>
              </main>
            </ThemeProvider>
          </ErpSessionProvider>
        </RBACProvider>
      </I18nProvider>
    </QueryClientProvider>
  </LumiereApiProvider>
}
