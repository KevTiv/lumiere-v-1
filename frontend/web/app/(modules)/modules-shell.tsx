"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  DashboardSidebar,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
} from "@lumiere/ui"
import { useErpSession } from "@lumiere/erp-session"
import type { ChatContext, ChatMessage, ChatMessageSourceRef } from "@lumiere/ui"
import {
  atCommandsToIncludeTypes,
  buildAiUiContext,
  parseAtCommands,
  resolveAiSourceHref,
  resolveErpCompanyId,
} from "@lumiere/query-hooks/ai-ui-context"
import {
  useAiChatMessages,
  useAppendAiChatMessage,
  useCreateAiChatSession,
  useAiMemoryRag,
  type AiRagSource,
} from "@lumiere/query-hooks/hooks/ai-memory"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { ErpAiRouteContextProvider, useErpAiRouteContext } from "@/lib/erp-ai-context"
import { performSignOut } from "@/lib/auth-sign-out"

const AI_CHAT_SESSION_KEY_STORAGE = "lumiere:erp-ai-chat-session-key"

function ensureAiChatSessionKey(): string {
  const existing = window.localStorage.getItem(AI_CHAT_SESSION_KEY_STORAGE)
  if (existing) return existing
  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `ai-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(AI_CHAT_SESSION_KEY_STORAGE, next)
  return next
}

function mapRagSourceToChatSource(s: AiRagSource): ChatMessageSourceRef {
  return {
    content_type: s.content_type,
    content_id: s.content_id,
    entity_type: s.entity_type,
    entity_id: s.entity_id,
    score: s.score,
    excerpt: s.text_snippet.length > 220 ? `${s.text_snippet.slice(0, 220)}…` : s.text_snippet,
    href: resolveAiSourceHref({
      content_type: s.content_type,
      content_id: s.content_id,
      entity_type: s.entity_type,
      entity_id: s.entity_id,
    }),
  }
}

function parseStoredSources(raw?: string | null): ChatMessageSourceRef[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as ChatMessageSourceRef[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function dateFromStored(raw: unknown): Date {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw > 10_000_000_000 ? raw / 1000 : raw)
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return dateFromStored(numeric)
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

function ErpAiChatPanel(props: Omit<ComponentProps<typeof AIChatPanel>, "onSendMessage" | "context">) {
  const { organizationId, companyIds } = useErpSession()
  const { route, module, activeTab, selection } = useErpAiRouteContext()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const companiesQuery = useCompanies(orgId, orgReady)
  const rag = useAiMemoryRag()
  const [sessionKey, setSessionKey] = useState<string | null>(null)

  const defaultCompanyId = useMemo(
    () =>
      resolveErpCompanyId({
        organizationId: orgId,
        sessionCompanyIds: companyIds,
        companyRows: companiesQuery.data ?? [],
      }),
    [companiesQuery.data, companyIds, orgId],
  )
  const createSession = useCreateAiChatSession(orgId, defaultCompanyId)
  const appendMessage = useAppendAiChatMessage(orgId, defaultCompanyId)
  const messagesQuery = useAiChatMessages(orgId, sessionKey, orgReady && defaultCompanyId != null)

  useEffect(() => {
    setSessionKey(ensureAiChatSessionKey())
  }, [])

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

  const initialMessages = useMemo((): ChatMessage[] | undefined => {
    if (!messagesQuery.data) return undefined
    return messagesQuery.data.map((row) => ({
      id: String(row.id),
      role:
        row.role === "user" || row.role === "assistant" || row.role === "system"
          ? row.role
          : "assistant",
      content: row.content,
      timestamp: dateFromStored(row.createDate ?? row.create_date),
      sources: parseStoredSources(row.sourcesJson ?? row.sources_json),
      metadata: {
        model: row.model ?? undefined,
        duration:
          row.durationMs != null
            ? Number(row.durationMs)
            : row.duration_ms != null
              ? Number(row.duration_ms)
              : undefined,
      },
    }))
  }, [messagesQuery.data])

  const ensureSession = useCallback(async () => {
    if (!sessionKey || !orgReady || defaultCompanyId == null || defaultCompanyId <= 0) return
    try {
      await createSession.mutateAsync({
        session_key: sessionKey,
        title: "ERP Assistant",
        route,
        module: module ?? null,
        active_tab: activeTab ?? null,
      })
    } catch (err) {
      console.warn("Unable to persist AI chat session", err)
    }
  }, [activeTab, createSession, defaultCompanyId, module, orgReady, route, sessionKey])

  const persistExchange = useCallback(
    async (args: {
      userText: string
      assistantText: string
      sources: ChatMessageSourceRef[]
      uiContext: unknown
      durationMs?: number
    }) => {
      if (!sessionKey || !orgReady || defaultCompanyId == null || defaultCompanyId <= 0) return
      try {
        await ensureSession()
        await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "user",
          content: args.userText,
          ui_context_json: JSON.stringify(args.uiContext ?? null),
        })
        await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "assistant",
          content: args.assistantText,
          sources_json: JSON.stringify(args.sources),
          ui_context_json: JSON.stringify(args.uiContext ?? null),
          model: "claude-sonnet-4-6",
          duration_ms: args.durationMs ?? null,
        })
      } catch (err) {
        console.warn("Unable to persist AI chat message", err)
      }
    },
    [appendMessage, defaultCompanyId, ensureSession, orgReady, sessionKey],
  )

  const buildRequestContext = useCallback(
    (userText: string) => {
      const atCommands = parseAtCommands(userText)
      return {
        atCommands,
        includeTypes: atCommandsToIncludeTypes(atCommands),
        uiContext: buildAiUiContext({
          pathname: route,
          companyId: defaultCompanyId,
          activeTab,
          atCommands,
          selection,
        }),
      }
    },
    [activeTab, defaultCompanyId, route, selection],
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

      const started = typeof performance !== "undefined" ? performance.now() : Date.now()
      const { includeTypes, uiContext } = buildRequestContext(userText)

      const out = await rag.mutateAsync({
        query: userText,
        companyId: defaultCompanyId,
        include_types: includeTypes,
        ui_context: uiContext,
      })

      const sources = (out.sources ?? []).map(mapRagSourceToChatSource)
      const finished = typeof performance !== "undefined" ? performance.now() : Date.now()
      void persistExchange({
        userText,
        assistantText: out.answer,
        sources,
        uiContext,
        durationMs: Math.round(finished - started),
      })

      return { content: out.answer, sources }
    },
    [buildRequestContext, companiesQuery.isLoading, defaultCompanyId, orgReady, persistExchange, rag],
  )

  const onStreamMessage = useCallback(
    async (
      userText: string,
      handlers: {
        onDelta: (delta: string) => void
        onSources: (sources: ChatMessageSourceRef[]) => void
      },
    ) => {
      if (!orgReady || defaultCompanyId == null || defaultCompanyId <= 0) {
        return onSendMessage(userText)
      }

      const started = typeof performance !== "undefined" ? performance.now() : Date.now()
      const { includeTypes, uiContext } = buildRequestContext(userText)
      const response = await fetch("/api/ai/rag/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userText,
          companyId: defaultCompanyId,
          ...(includeTypes.length ? { include_types: includeTypes } : {}),
          ...(uiContext ? { ui_context: uiContext } : {}),
        }),
      })

      if (!response.ok || !response.body) {
        return onSendMessage(userText)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let content = ""
      let sources: ChatMessageSourceRef[] = []

      const processEvent = (raw: string) => {
        const lines = raw.split(/\r?\n/)
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim()
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (event === "delta") {
          content += data
          handlers.onDelta(data)
        } else if (event === "sources") {
          const parsed = JSON.parse(data) as { sources?: AiRagSource[] }
          sources = (parsed.sources ?? []).map(mapRagSourceToChatSource)
          handlers.onSources(sources)
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split(/\n\n/)
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          if (part.trim()) processEvent(part)
        }
      }
      if (buffer.trim()) processEvent(buffer)

      const finished = typeof performance !== "undefined" ? performance.now() : Date.now()
      void persistExchange({
        userText,
        assistantText: content,
        sources,
        uiContext,
        durationMs: Math.round(finished - started),
      })

      return { content, sources }
    },
    [buildRequestContext, defaultCompanyId, onSendMessage, orgReady, persistExchange],
  )

  return (
    <AIChatPanel
      {...props}
      context={chatContext}
      initialMessages={initialMessages}
      onSendMessage={onSendMessage}
      onStreamMessage={onStreamMessage}
    />
  )
}

function ModulesContent({ children }: { children: ReactNode }) {
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [isAIChatDocked, setIsAIChatDocked] = useState(false)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30 text-foreground">
      <DashboardSidebar
        forceCollapsed={isAIChatDocked || isNotebookOpen}
        onOpenJournal={() => setIsJournalOpen(true)}
        onOpenNotebook={() => setIsNotebookOpen(true)}
        onOpenAIChat={() => setIsAIChatOpen(true)}
        onSignOut={() => void performSignOut()}
      />
      <main className="flex-1 overflow-auto scroll-smooth">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</div>
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
