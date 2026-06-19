"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  DashboardSidebar,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
} from "@lumiere/ui"
import { useErpSession } from "@lumiere/erp-session"
import type { ChatContext, ChatMessage, ChatMessageSourceRef, ChatAction } from "@lumiere/ui"
import {
  atCommandsToIncludeTypes,
  buildAiUiContext,
  parseAtCommands,
  resolveAiSourceHref,
} from "@lumiere/query-hooks/ai-ui-context"
import {
  chatActionsToMetadata,
  looksLikeActionDraftRequest,
  parseStoredChatActions,
  persistedDraftsToChatActions,
} from "@lumiere/query-hooks/action-draft-intent"
import {
  useAiChatMessages,
  useAppendAiChatMessage,
  useCreateAiChatSession,
  useAiMemoryRag,
  type AiRagSource,
} from "@lumiere/query-hooks/hooks/ai-memory"
import {
  useAiActionDraft,
} from "@lumiere/query-hooks/hooks/ai-harness"
import {
  useApproveAiActionDraft,
  useAiActionDraftInboxCount,
  usePersistGatewayActionDrafts,
  useRejectAiActionDraft,
  useUpdateAiActionDraftParams,
} from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
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
  const kind =
    s.kind === "live" || s.kind === "memory" || s.kind === "activity" || s.kind === "web"
      ? s.kind
      : s.content_type === "org_activity"
        ? "activity"
        : "memory"
  const trust =
    s.trust === "authoritative" || s.trust === "retrieved"
      ? s.trust
      : kind === "live"
        ? "authoritative"
        : "retrieved"

  return {
    kind,
    trust,
    content_type: s.content_type,
    content_id: s.content_id,
    entity_type: s.entity_type,
    entity_id: s.entity_id,
    label: s.label,
    field: s.field,
    score: s.score,
    excerpt: s.text_snippet.length > 220 ? `${s.text_snippet.slice(0, 220)}…` : s.text_snippet,
    snapshot_at: s.snapshot_at,
    url: s.url,
    fetched_at: s.fetched_at,
    href: s.url ?? resolveAiSourceHref({
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
  const { organizationId } = useErpSession()
  const { route, module, activeTab, selection } = useErpAiRouteContext()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const rag = useAiMemoryRag()
  const actionDraft = useAiActionDraft()
  const [sessionKey, setSessionKey] = useState<string | null>(null)

  const persistActionDrafts = usePersistGatewayActionDrafts(orgId, operatingCompanyId ?? 0)
  const approveActionDraft = useApproveAiActionDraft(orgId, operatingCompanyId ?? 0)
  const rejectActionDraft = useRejectAiActionDraft(orgId, operatingCompanyId ?? 0)
  const updateActionDraft = useUpdateAiActionDraftParams(orgId, operatingCompanyId ?? 0)
  const createSession = useCreateAiChatSession(orgId, operatingCompanyId)
  const appendMessage = useAppendAiChatMessage(orgId, operatingCompanyId)
  const messagesQuery = useAiChatMessages(orgId, sessionKey, orgReady && operatingCompanyId != null)
  const companiesQuery = useCompanies(orgId, orgReady)

  useEffect(() => {
    setSessionKey(ensureAiChatSessionKey())
  }, [])

  const chatContext = useMemo(
    (): ChatContext => ({
      activeView: module ?? route,
      route,
      module: module ?? undefined,
      activeTab: activeTab ?? undefined,
      companyId: operatingCompanyId ?? undefined,
      selectedData: selection ?? undefined,
    }),
    [activeTab, operatingCompanyId, module, route, selection],
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
      actions: parseStoredChatActions(row.metadata) as ChatAction[] | undefined,
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
    if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return
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
  }, [activeTab, createSession, operatingCompanyId, module, orgReady, route, sessionKey])

  const persistExchange = useCallback(
    async (args: {
      userText: string
      assistantText: string
      sources: ChatMessageSourceRef[]
      uiContext: unknown
      durationMs?: number
      model?: string | null
      actions?: ChatAction[]
    }) => {
      if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return
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
          model: args.model ?? null,
          duration_ms: args.durationMs ?? null,
          metadata:
            args.actions?.length
              ? chatActionsToMetadata(
                  args.actions.filter(
                    (action): action is Extract<ChatAction, { type: "draft" }> =>
                      action.type === "draft" && action.draft != null,
                  ),
                )
              : null,
        })
      } catch (err) {
        console.warn("Unable to persist AI chat message", err)
      }
    },
    [appendMessage, operatingCompanyId, ensureSession, orgReady, sessionKey],
  )

  const buildRequestContext = useCallback(
    (userText: string) => {
      const atCommands = parseAtCommands(userText)
      return {
        atCommands,
        includeTypes: atCommandsToIncludeTypes(atCommands),
        uiContext: buildAiUiContext({
          pathname: route,
          companyId: operatingCompanyId,
          activeTab,
          atCommands,
          selection,
        }),
      }
    },
    [activeTab, operatingCompanyId, route, selection],
  )

  const resolveActionDrafts = useCallback(
    async (userText: string, uiContext: unknown): Promise<ChatAction[]> => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return []
      if (!looksLikeActionDraftRequest(userText)) return []

      try {
        const draftResponse = await actionDraft.mutateAsync({
          companyId: operatingCompanyId,
          query: userText,
          ui_context: uiContext as Parameters<typeof actionDraft.mutateAsync>[0]["ui_context"],
        })
        const gatewayDrafts = draftResponse.drafts ?? []
        if (gatewayDrafts.length === 0) return []

        const persisted = await persistActionDrafts.mutateAsync({
          drafts: gatewayDrafts,
          sourceQuery: userText,
          uiContextJson: JSON.stringify(uiContext ?? null),
        })
        return persistedDraftsToChatActions(persisted, operatingCompanyId ?? undefined) as ChatAction[]
      } catch (err) {
        console.warn("Unable to create AI action draft", err)
        return []
      }
    },
    [actionDraft, operatingCompanyId, orgReady, persistActionDrafts],
  )

  const chatConfig = useMemo(
    () => ({
      ...props.config,
      onApproveActionDraft: async (draft: { draftId: number; companyId?: number }) => {
        await approveActionDraft.mutateAsync({
          draftId: draft.draftId,
          companyId: draft.companyId,
        })
      },
      onRejectActionDraft: async (
        draft: { draftId: number; companyId?: number },
        reason?: string,
      ) => {
        await rejectActionDraft.mutateAsync({
          draftId: draft.draftId,
          reason,
          companyId: draft.companyId,
        })
      },
      onUpdateActionDraft: async (draft: {
        draftId: number
        paramsJson: Record<string, unknown>
        summary: string
        companyId?: number
      }) => {
        await updateActionDraft.mutateAsync({
          draftId: draft.draftId,
          paramsJson: JSON.stringify(draft.paramsJson),
          summary: draft.summary,
          companyId: draft.companyId,
        })
      },
    }),
    [approveActionDraft, props.config, rejectActionDraft, updateActionDraft],
  )

  const onSendMessage = useCallback(
    async (userText: string) => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) {
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

      const [out, draftActions] = await Promise.all([
        rag.mutateAsync({
          query: userText,
          companyId: operatingCompanyId,
          include_types: includeTypes,
          ui_context: uiContext,
        }),
        resolveActionDrafts(userText, uiContext),
      ])

      const sources = (out.sources ?? []).map(mapRagSourceToChatSource)
      const finished = typeof performance !== "undefined" ? performance.now() : Date.now()
      const assistantText =
        draftActions.length > 0 && !out.answer.includes("draft")
          ? `${out.answer}\n\nI've prepared ${draftActions.length} action draft${draftActions.length === 1 ? "" : "s"} below for your approval. Open AI Approvals in the sidebar to review the team inbox.`
          : out.answer
      void persistExchange({
        userText,
        assistantText,
        sources,
        uiContext,
        durationMs: Math.round(finished - started),
        model: out.model ?? null,
        actions: draftActions.length > 0 ? draftActions : undefined,
      })

      return {
        content: assistantText,
        sources,
        actions: draftActions.length > 0 ? draftActions : undefined,
      }
    },
    [
      buildRequestContext,
      companiesQuery.isLoading,
      operatingCompanyId,
      orgReady,
      persistExchange,
      rag,
      resolveActionDrafts,
    ],
  )

  const onStreamMessage = useCallback<
    NonNullable<ComponentProps<typeof AIChatPanel>["onStreamMessage"]>
  >(
    async (userText, handlers) => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) {
        return onSendMessage(userText)
      }

      const started = typeof performance !== "undefined" ? performance.now() : Date.now()
      const { includeTypes, uiContext } = buildRequestContext(userText)
      const draftPromise = resolveActionDrafts(userText, uiContext)
      const response = await fetch("/api/ai/rag/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userText,
          companyId: operatingCompanyId,
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
      let resolvedModel: string | null = null

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
          const parsed = JSON.parse(data) as {
            sources?: AiRagSource[]
            model?: string
          }
          sources = (parsed.sources ?? []).map(mapRagSourceToChatSource)
          resolvedModel = parsed.model ?? null
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

      const draftActions = await draftPromise
      if (draftActions.length > 0) {
        handlers.onActions?.(draftActions)
        if (!content.includes("draft")) {
          content = `${content}\n\nI've prepared ${draftActions.length} action draft${draftActions.length === 1 ? "" : "s"} below for your approval. Open AI Approvals in the sidebar to review the team inbox.`
          handlers.onDelta(
            `\n\nI've prepared ${draftActions.length} action draft${draftActions.length === 1 ? "" : "s"} below for your approval. Open AI Approvals in the sidebar to review the team inbox.`,
          )
        }
      }

      const finished = typeof performance !== "undefined" ? performance.now() : Date.now()
      void persistExchange({
        userText,
        assistantText: content,
        sources,
        uiContext,
        durationMs: Math.round(finished - started),
        model: resolvedModel,
        actions: draftActions.length > 0 ? draftActions : undefined,
      })

      return {
        content,
        sources,
        actions: draftActions.length > 0 ? draftActions : undefined,
      }
    },
    [
      buildRequestContext,
      operatingCompanyId,
      onSendMessage,
      orgReady,
      persistExchange,
      resolveActionDrafts,
    ],
  )

  return (
    <AIChatPanel
      {...props}
      config={chatConfig}
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
  const { organizationId } = useErpSession()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const inboxCountQuery = useAiActionDraftInboxCount(
    orgId,
    orgReady && operatingCompanyId != null && operatingCompanyId > 0,
  )
  const navBadges = useMemo(
    () =>
      inboxCountQuery.count > 0
        ? { "/ai-action-drafts": inboxCountQuery.count }
        : undefined,
    [inboxCountQuery.count],
  )

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30 text-foreground">
      <DashboardSidebar
        forceCollapsed={isAIChatDocked || isNotebookOpen}
        navBadges={navBadges}
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
