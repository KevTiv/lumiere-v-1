"use client"

import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  DashboardSidebar,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
} from "@lumiere/ui"
import { useErpSession } from "@lumiere/erp-session"
import type { ChatMessageSourceRef } from "@lumiere/ui"
import { useAiMemoryRag } from "@lumiere/query-hooks/hooks/ai-memory"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"

function numId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "bigint") return Number(v)
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function ErpAiChatPanel(props: Omit<ComponentProps<typeof AIChatPanel>, "onSendMessage">) {
  const { organizationId } = useErpSession()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const companiesQuery = useCompanies(orgId, orgReady)
  const rag = useAiMemoryRag()

  const defaultCompanyId = useMemo(() => {
    const rows = companiesQuery.data ?? []
    if (rows.length === 0) return null
    const raw = rows[0]?.["id"]
    return numId(raw)
  }, [companiesQuery.data])

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

      const out = await rag.mutateAsync({
        query: userText,
        companyId: defaultCompanyId,
      })

      const sources: ChatMessageSourceRef[] = (out.sources ?? []).map((s) => ({
        content_type: s.content_type,
        content_id: s.content_id,
        score: s.score,
        excerpt:
          s.text_snippet.length > 220 ? `${s.text_snippet.slice(0, 220)}…` : s.text_snippet,
      }))

      return { content: out.answer, sources }
    },
    [companiesQuery.isLoading, defaultCompanyId, orgReady, rag],
  )

  return <AIChatPanel {...props} onSendMessage={onSendMessage} />
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
        context={{}}
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
  return <ModulesContent>{children}</ModulesContent>
}
