"use client"

import { Suspense, useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  DashboardSidebar,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
} from "@lumiere/ui"
import { useErpSession } from "@lumiere/erp-session"
import type { ChatContext, ChatMessageSourceRef } from "@lumiere/ui"
import {
  atCommandsToIncludeTypes,
  buildAiUiContext,
  parseAtCommands,
  resolveAiSourceHref,
  resolveErpCompanyId,
} from "@lumiere/query-hooks/ai-ui-context"
import { useAiMemoryRag } from "@lumiere/query-hooks/hooks/ai-memory"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { ErpAiRouteContextProvider, useErpAiRouteContext } from "@/lib/erp-ai-context"
import { performSignOut } from "@/lib/auth-sign-out"

function ErpAiChatPanel(props: Omit<ComponentProps<typeof AIChatPanel>, "onSendMessage" | "context">) {
  const { organizationId, companyIds } = useErpSession()
  const { route, module, activeTab, selection } = useErpAiRouteContext()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const companiesQuery = useCompanies(orgId, orgReady)
  const rag = useAiMemoryRag()

  const defaultCompanyId = useMemo(
    () =>
      resolveErpCompanyId({
        organizationId: orgId,
        sessionCompanyIds: companyIds,
        companyRows: companiesQuery.data ?? [],
      }),
    [companiesQuery.data, companyIds, orgId],
  )

  const chatContext = useMemo(
    (): ChatContext => ({
      activeView: module ?? route,
      route,
      module: module ?? undefined,
      activeTab: activeTab ?? undefined,
      companyId: defaultCompanyId ?? undefined,
      selectedData: selection ?? undefined,
    }),
    [activeTab, defaultCompanyId, module, route, selection],
  )

  const onSendMessage = useCallback(
    async (userText: string) => {
      if (!orgReady || defaultCompanyId == null || defaultCompanyId <= 0) {
        return {
          content:
            companiesQuery.isLoading
              ? "Loading companies… Configure a legal entity first, then try again."
              : "No company found for this organization. Create a company record, then open the ERP Assistant again.",
          sources: [] as ChatMessageSourceRef[],
        }
      }

      const atCommands = parseAtCommands(userText)
      const includeTypes = atCommandsToIncludeTypes(atCommands)
      const uiContext = buildAiUiContext({
        pathname: route,
        companyId: defaultCompanyId,
        activeTab,
        atCommands,
        selection,
      })

      const out = await rag.mutateAsync({
        query: userText,
        companyId: defaultCompanyId,
        include_types: includeTypes,
        ui_context: uiContext,
      })

      const sources: ChatMessageSourceRef[] = (out.sources ?? []).map((s) => ({
        content_type: s.content_type,
        content_id: s.content_id,
        score: s.score,
        excerpt:
          s.text_snippet.length > 220 ? `${s.text_snippet.slice(0, 220)}…` : s.text_snippet,
        href: resolveAiSourceHref({
          content_type: s.content_type,
          content_id: s.content_id,
        }),
      }))

      return { content: out.answer, sources }
    },
    [activeTab, companiesQuery.isLoading, defaultCompanyId, orgReady, rag, route, selection],
  )

  return <AIChatPanel {...props} context={chatContext} onSendMessage={onSendMessage} />
}

function ModulesContent({ children }: { children: ReactNode }) {
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [isAIChatDocked, setIsAIChatDocked] = useState(false)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar
        forceCollapsed={isAIChatDocked || isNotebookOpen}
        onOpenJournal={() => setIsJournalOpen(true)}
        onOpenNotebook={() => setIsNotebookOpen(true)}
        onOpenAIChat={() => setIsAIChatOpen(true)}
        onSignOut={() => void performSignOut()}
      />
      <main className="flex-1 overflow-auto scroll-smooth">
        <div className="p-6 lg:p-8">{children}</div>
      </main>

      <ErpAiChatPanel
        open={isAIChatOpen}
        onClose={() => {
          setIsAIChatOpen(false)
          setIsAIChatDocked(false)
        }}
        docked={isAIChatDocked}
        onDockToggle={() => setIsAIChatDocked((prev) => !prev)}
        config={{
          title: "ERP Assistant",
          welcomeMessage: "Ask questions about your data or use @ commands for quick actions.",
          placeholder: "Ask anything... Type @ for commands",
        }}
      />

      <NotebookPanel
        open={isNotebookOpen}
        onClose={() => setIsNotebookOpen(false)}
        onAIChat={() => setIsAIChatOpen(true)}
        dataContext={{}}
      />

      <JournalPanel open={isJournalOpen} onClose={() => setIsJournalOpen(false)} />
    </div>
  )
}

export default function ModulesShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ErpAiRouteContextProvider>
        <ModulesContent>{children}</ModulesContent>
      </ErpAiRouteContextProvider>
    </Suspense>
  )
}
