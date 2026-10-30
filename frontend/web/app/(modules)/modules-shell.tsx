"use client"

import { WorkspaceProfileProvider, useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react"
import {
  DashboardSidebar,
  DashboardWorkspace,
  ErpCommandPalette,
  AIChatPanel,
  NotebookPanel,
  JournalPanel,
  ChatterUploaderProvider,
  NotificationBell,
  recentNotifications,
} from "@lumiere/ui"
import { useWebChatterUploader } from "@/lib/chatter-attachment-uploader"
import { AssistantGuideHost } from "../../components/assistant-guide-host"
import { AssistantGuideConversationProvider, useAssistantGuideConversation } from "@/lib/assistant-guide-context"
import { guideDraftQuestion, guideQuestionEdits, guideQuestionContext, guideRequestInScope, guideLibraryHref, guideReferencesMetadata, parseStoredGuideReferences, readAssistantGuide, withGuideReferencesMetadata } from "@/lib/assistant-guides"
import { isSavedGuide, type GuideDocument, type GuideDraft, type GuideReference, type OpenGuideRequest } from "@lumiere/ui/lib/assistant-guide-types"
import { EntityCurrencyBoundary } from "@/lib/entity-currency-boundary"
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
  parseStoredChatRunId,
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
  usePersistGatewayActionDrafts,
  useRejectAiActionDraft,
  useUpdateAiActionDraftParams,
} from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useApprovalInboxCount } from "@lumiere/query-hooks/hooks/approvals"
import { useRecordEvidenceContribution } from "@lumiere/query-hooks/hooks/ai-evidence-contributions"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { ErpAiRouteContextProvider, ErpAiChatControllerProvider, useErpAiRouteContext } from "@/lib/erp-ai-context"
import { AI_WORKSPACE_SCOPES, resolveAiWorkspaceScope } from "@/lib/ai-workspace-scope"
import { performSignOut } from "@/lib/auth-sign-out"
import { assistantAnswer, assistantAnswerMetadata, coordinateAssistantTurn, readAssistantStream, type TurnFailure } from "@/lib/assistant-turn"
import { i18n } from "@lumiere/i18n"
import { assistantHistoryScope, saveAssistantHistory, scopedAssistantSession } from "@/lib/assistant-history"
import { recordPageHref } from "@/lib/record-page-href"
import { useCurrentUserProfile } from "@lumiere/query-hooks/hooks/auth"
import {
  useMailMessages,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "@lumiere/query-hooks/hooks/messages"

function mapRagSourceToChatSource(s: AiRagSource): ChatMessageSourceRef {
  return {
    kind: s.kind,
    trust: s.trust,
    entity_type: s.entity_type,
    entity_id: s.entity_id,
    source_kind: s.source_kind,
    source_key: s.source_key,
    source_version: s.source_version,
    passage_id: s.passage_id,
    passage_key: s.passage_key,
    content_hash: s.content_hash,
    label: s.label,
    field: s.field,
    score: s.score,
    excerpt: s.text_snippet.length > 220 ? `${s.text_snippet.slice(0, 220)}…` : s.text_snippet,
    snapshot_at: s.snapshot_at,
    url: s.url,
    fetched_at: s.fetched_at,
    href: s.url ?? resolveAiSourceHref({
      entity_type: s.entity_type,
      entity_id: s.entity_id,
      source_kind: s.source_kind,
      source_key: s.source_key,
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
  const { organizationId, identity } = useErpSession()
  const { route, module, activeTab, selection } = useErpAiRouteContext()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const rag = useAiMemoryRag()
  const actionDraft = useAiActionDraft()
  const actorHistoryScope = assistantHistoryScope(identity, organizationId, operatingCompanyId)
  const [historySession, setHistorySession] = useState<{ scope: string; key: string } | null>(null)
  const sessionKey = historySession?.scope === actorHistoryScope ? historySession.key : null
  const [failedHistoryScope, setFailedHistoryScope] = useState<string | null>(null)
  const historyScope = JSON.stringify([identity, organizationId, operatingCompanyId, sessionKey])
  const currentHistoryScope = useRef(historyScope)
  currentHistoryScope.current = historyScope
  const [selectedScope, setSelectedScope] = useState("current")
  const [openGuide, setOpenGuide] = useState<{ scope: string; request: OpenGuideRequest } | null>(null)
  const guideConversation = useAssistantGuideConversation()
  const activeScope = useRef<string | null>(null)
  activeScope.current = actorHistoryScope
  const workspaceScope = useMemo(
    () => resolveAiWorkspaceScope(selectedScope, route, selection),
    [selectedScope, route, selection],
  )

  const persistActionDrafts = usePersistGatewayActionDrafts(orgId, operatingCompanyId ?? 0)
  const approveActionDraft = useApproveAiActionDraft(orgId, operatingCompanyId ?? 0)
  const rejectActionDraft = useRejectAiActionDraft(orgId, operatingCompanyId ?? 0)
  const updateActionDraft = useUpdateAiActionDraftParams(orgId, operatingCompanyId ?? 0)
  const createSession = useCreateAiChatSession(orgId, operatingCompanyId)
  const appendMessage = useAppendAiChatMessage(orgId, operatingCompanyId)
  const citeSource = useRecordEvidenceContribution(orgId)
  const messagesQuery = useAiChatMessages(orgId, sessionKey, orgReady && operatingCompanyId != null)
  const companiesQuery = useCompanies(orgId, orgReady)

  useEffect(() => {
    if (!actorHistoryScope) return
    const createKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID() : `ai-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
    try {
      setHistorySession({ scope: actorHistoryScope, key: scopedAssistantSession(window.localStorage, actorHistoryScope, createKey) })
    } catch {
      const key = createKey()
      setHistorySession({ scope: actorHistoryScope, key })
      setFailedHistoryScope(JSON.stringify([identity, organizationId, operatingCompanyId, key]))
    }
  }, [actorHistoryScope, identity, organizationId, operatingCompanyId])

  const chatContext = useMemo(
    (): ChatContext => ({
      activeView: workspaceScope.usesCurrentPage ? module ?? route : workspaceScope.label,
      route: workspaceScope.pathname,
      module: workspaceScope.usesCurrentPage ? module ?? undefined : undefined,
      activeTab: workspaceScope.usesCurrentPage ? activeTab ?? undefined : undefined,
      companyId: operatingCompanyId ?? undefined,
      selectedData: workspaceScope.selection ?? undefined,
    }),
    [activeTab, operatingCompanyId, module, route, workspaceScope],
  )

  const initialMessages = useMemo((): ChatMessage[] | undefined => {
    if (!sessionKey || !actorHistoryScope) return []
    if (!messagesQuery.data) return undefined
    return messagesQuery.data.filter((row) => String(row.organizationId ?? row.organization_id) === String(orgId)
      && String(row.companyId ?? row.company_id) === String(operatingCompanyId)).map((row) => ({
      id: String(row.id),
      role:
        row.role === "user" || row.role === "assistant" || row.role === "system"
          ? row.role
          : "assistant",
      content: row.content,
      timestamp: dateFromStored(row.createDate ?? row.create_date),
      sources: parseStoredSources(row.sourcesJson ?? row.sources_json),
      actions: parseStoredChatActions(row.metadata) as ChatAction[] | undefined,
      guides: parseStoredGuideReferences(row.metadata),
      metadata: {
        model: row.model ?? undefined,
        duration:
          row.durationMs != null
            ? Number(row.durationMs)
            : row.duration_ms != null
              ? Number(row.duration_ms)
              : undefined,
        runId: parseStoredChatRunId(row.metadata),
      },
    }))
  }, [messagesQuery.data, sessionKey, actorHistoryScope, orgId, operatingCompanyId])

  const ensureSession = useCallback(async () => {
    if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) throw new Error("Conversation context is unavailable")
    await createSession.mutateAsync({
        session_key: sessionKey,
        title: "Lumière Assistant",
        route,
        module: module ?? null,
        active_tab: activeTab ?? null,
    })
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
      runId?: number
      guides?: GuideReference[]
    }) => {
      if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return
      const result = await saveAssistantHistory({
        ensureSession,
        isCurrent: () => currentHistoryScope.current === historyScope,
        appendUser: async () => { await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "user",
          content: args.userText,
          ui_context_json: JSON.stringify(args.uiContext ?? null),
        }) },
        appendAssistant: async () => { await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "assistant",
          content: args.assistantText,
          sources_json: JSON.stringify(args.sources),
          ui_context_json: JSON.stringify(args.uiContext ?? null),
          model: args.model ?? null,
          duration_ms: args.durationMs ?? null,
          metadata: withGuideReferencesMetadata(
            args.actions?.length || args.runId != null
              ? chatActionsToMetadata(
                  (args.actions ?? []).filter(
                    (action): action is Extract<ChatAction, { type: "draft" }> =>
                      action.type === "draft" && action.draft != null,
                  ),
                  args.runId,
                )
              : null,
            args.guides,
          ),
        }) },
      })
      if (result === "failed") setFailedHistoryScope(historyScope)
    },
    [appendMessage, operatingCompanyId, ensureSession, orgReady, sessionKey, historyScope],
  )

  const buildRequestContext = useCallback(
    (userText: string, questionGuide?: GuideDraft) => {
      const guideContext = questionGuide ? guideQuestionContext(questionGuide) : undefined
      const atCommands = [...new Set([...parseAtCommands(userText), ...(guideContext?.commands ?? workspaceScope.commands)])]
      return {
        atCommands,
        includeTypes: atCommandsToIncludeTypes(atCommands),
        uiContext: buildAiUiContext({
          pathname: guideContext?.pathname ?? workspaceScope.pathname,
          companyId: operatingCompanyId,
          activeTab: guideContext ? guideContext.activeTab : workspaceScope.usesCurrentPage ? activeTab : null,
          atCommands,
          selection: guideContext ? guideContext.selection : workspaceScope.selection,
        }),
      }
    },
    [activeTab, operatingCompanyId, workspaceScope],
  )

  const resolveActionDrafts = useCallback(
    async (userText: string, uiContext: unknown): Promise<ChatAction[]> => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return []
      if (!looksLikeActionDraftRequest(userText)) return []

      const draftScope = currentHistoryScope.current
      const draftResponse = await actionDraft.mutateAsync({
        companyId: operatingCompanyId,
        query: userText,
        uiContext: uiContext as Parameters<typeof actionDraft.mutateAsync>[0]["uiContext"],
      })
      if (currentHistoryScope.current !== draftScope) return []
      const gatewayDrafts = draftResponse.drafts ?? []
      if (gatewayDrafts.length === 0) return []
      const persisted = await persistActionDrafts.mutateAsync({
        drafts: gatewayDrafts,
        sourceQuery: userText,
        uiContextJson: JSON.stringify(uiContext ?? null),
      })
      return persistedDraftsToChatActions(persisted, operatingCompanyId) as ChatAction[]
    },
    [actionDraft, operatingCompanyId, orgReady, persistActionDrafts],
  )

  const chatConfig = useMemo(
    () => ({
      ...props.config,
      guideLibraryHref: operatingCompanyId ? guideLibraryHref(String(operatingCompanyId), module ?? undefined) : undefined,
      onOpenGuide: (request: OpenGuideRequest) => {
        if (actorHistoryScope) setOpenGuide({ scope: actorHistoryScope, request })
      },
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
      onCiteSource: async ({ messageId, source }: { messageId: string; source: ChatMessageSourceRef }) => {
        if (!sessionKey || operatingCompanyId == null || operatingCompanyId <= 0 || source.passage_id == null) {
          throw new Error("Chat session or passage reference is not ready")
        }
        await citeSource.mutateAsync({
          companyId: operatingCompanyId,
          sessionRef: sessionKey,
          turnRef: messageId,
          eventRef: `cite:${messageId}:${source.passage_id}`,
          introducedKind: "source_version",
          passageId: source.passage_id,
          inspectionState: "user_reported",
        })
      },
    }),
    [
      approveActionDraft,
      actorHistoryScope,
      citeSource,
      operatingCompanyId,
      props.config,
      rejectActionDraft,
      sessionKey,
      updateActionDraft,
      module,
    ],
  )

  const runTurn = useCallback(
    async (userText: string, stream = false, guideRefs?: GuideReference[], questionGuide?: GuideDraft, hasUnsavedGuideEdits = false) => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) {
        return {
          content: companiesQuery.isLoading
            ? i18n.t("aiChat.turn.loadingCompany")
            : i18n.t("aiChat.turn.companyRequired"),
          sources: [] as ChatMessageSourceRef[],
        }
      }
      const started = performance.now()
      const requestScope = historyScope
      const isCurrent = () => currentHistoryScope.current === requestScope
      const { includeTypes, uiContext } = buildRequestContext(userText, questionGuide)
      const turn = await coordinateAssistantTurn({
        isCurrent,
        answer: async () => {
          if (!stream) return assistantAnswer(await rag.mutateAsync({
            query: questionGuide ? guideDraftQuestion(questionGuide, userText, hasUnsavedGuideEdits) : userText, companyId: operatingCompanyId,
            include_types: includeTypes, ui_context: uiContext, guide_refs: guideRefs,
          }))
          const response = await fetch("/api/ai/rag/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: questionGuide ? guideDraftQuestion(questionGuide, userText, hasUnsavedGuideEdits) : userText, companyId: operatingCompanyId,
              ...(includeTypes.length ? { include_types: includeTypes } : {}),
              ...(uiContext ? { ui_context: uiContext } : {}),
              ...(guideRefs?.length ? { guide_refs: guideRefs } : {}),
            }),
          })
          // Never fall back after dispatch: a missing reply does not prove no run occurred.
          return readAssistantStream(response, (data) => assistantAnswerMetadata(JSON.parse(data)))
        },
        drafts: looksLikeActionDraftRequest(userText) ? () => resolveActionDrafts(userText, uiContext) : undefined,
      })
      if ("kind" in turn) return { content: "", sources: [] as ChatMessageSourceRef[] }
      const out = turn.answer.kind === "ready" ? turn.answer.value : undefined
      const sources = (out?.sources ?? []).map(mapRagSourceToChatSource)
      const guides = out?.guides
      const draftActions = turn.drafts.kind === "ready" ? turn.drafts.value : []
      const failureText = (phase: "answer" | "draft", failure: TurnFailure) => i18n.t(`aiChat.turn.${phase}.${failure}`)
      const parts = [turn.answer.kind === "ready" ? turn.answer.value.answer : failureText("answer", turn.answer.kind)]
      if (turn.drafts.kind === "ready") {
        parts.push(draftActions.length ? i18n.t("aiChat.turn.reviewDrafts") : i18n.t("aiChat.turn.noDraft"))
      } else if (turn.drafts.kind !== "not_requested") parts.push(failureText("draft", turn.drafts.kind))
      const content = parts.join("\n\n")
      void persistExchange({
        userText, assistantText: content, sources, uiContext, guides,
        durationMs: Math.round(performance.now() - started), model: out?.model ?? null,
        actions: draftActions.length ? draftActions : undefined, runId: out?.run_id,
      })
      return { content, runId: out?.run_id, sources, guides, actions: draftActions.length ? draftActions : undefined }
    },
    [orgReady, operatingCompanyId, companiesQuery.isLoading, historyScope, buildRequestContext, rag, resolveActionDrafts, persistExchange],
  )
  const onSendMessage = useCallback((text: string, guideRefs?: GuideReference[], questionGuide?: GuideDraft, hasUnsavedGuideEdits = false) => runTurn(text, false, guideRefs, questionGuide, hasUnsavedGuideEdits), [runTurn])
  const onStreamMessage = useCallback<NonNullable<ComponentProps<typeof AIChatPanel>["onStreamMessage"]>>(
    async (text, handlers) => {
      const reply = await runTurn(text, true)
      handlers.onDelta(reply.content)
      handlers.onSources(reply.sources)
      if (reply.actions) handlers.onActions?.(reply.actions)
      return reply
    }, [runTurn],
  )

  const onGuideSaved = useCallback(async (guide: GuideDocument) => {
    const scope = actorHistoryScope
    if (!scope || activeScope.current !== scope) throw new Error("The conversation scope changed")
    if (!sessionKey || !orgReady || operatingCompanyId == null || guide.companyId !== String(operatingCompanyId)) throw new Error("The conversation scope changed")
    await ensureSession()
    if (activeScope.current !== scope) throw new Error("The conversation scope changed")
    await appendMessage.mutateAsync({
      session_key: sessionKey,
      role: "assistant",
      content: "Saved a guide to the current company's knowledge library.",
      sources_json: "[]",
      metadata: guideReferencesMetadata(guide),
    })
  }, [appendMessage, ensureSession, operatingCompanyId, orgReady, sessionKey, actorHistoryScope])

  const askAboutGuide = useCallback(async (guide: GuideDraft | GuideDocument, question: string, draftOverride?: GuideDraft) => {
    const scope = actorHistoryScope
    if (!scope || activeScope.current !== scope) throw new Error("The conversation scope changed")
    if (guide.companyId !== String(operatingCompanyId) || !sessionKey) throw new Error("Open the guide in the current company before asking a question.")
    let references: GuideReference[] | undefined
    let currentGuide = guide
    if (isSavedGuide(guide)) {
      currentGuide = await readAssistantGuide(guide, guide.companyId)
      if (activeScope.current !== scope) throw new Error("The company changed. Reopen the guide before asking.")
      references = [{ guideId: guide.guideId, revision: guide.revision }]
    }
    if (draftOverride) currentGuide = guideQuestionEdits(currentGuide, draftOverride)
    const reply = await onSendMessage(question, references, currentGuide, Boolean(draftOverride))
    if (activeScope.current !== scope) throw new Error("The company changed while answering. Reopen the guide in the current company.")
    return reply.content
  }, [onSendMessage, operatingCompanyId, actorHistoryScope, sessionKey])

  useEffect(() => guideConversation.register(askAboutGuide), [guideConversation.register, askAboutGuide])

  return <>
    <AIChatPanel
      key={JSON.stringify([identity, organizationId, operatingCompanyId])}
      {...props}
      config={chatConfig}
      context={chatContext}
      initialMessages={initialMessages}
      historySaveFailed={failedHistoryScope === historyScope}
      contextOptions={AI_WORKSPACE_SCOPES}
      selectedContext={selectedScope}
      onContextChange={setSelectedScope}
      onSendMessage={onSendMessage}
      onStreamMessage={onStreamMessage}
    />
    <AssistantGuideHost request={guideRequestInScope(openGuide, actorHistoryScope)} organizationId={orgId} companyId={operatingCompanyId ?? undefined}
      onClose={() => setOpenGuide(null)} onSaved={onGuideSaved} onAsk={askAboutGuide} />
  </>
}

/** Header bell: unread notifications addressed to the signed-in user. */
function HeaderNotificationBell({ organizationId }: { organizationId: number }) {
  const { identity } = useErpSession()
  const orgId = BigInt(organizationId)
  const { data: messages = [] } = useMailMessages(orgId)
  const markNotificationRead = useMarkNotificationRead(orgId)
  const markAllNotificationsRead = useMarkAllNotificationsRead(orgId)
  const notifications = useMemo(
    () => recentNotifications(messages as unknown as Record<string, unknown>[], identity),
    [messages, identity],
  )
  return (
    <NotificationBell
      notifications={notifications}
      viewAllHref="/messages"
      itemHref={(n) => `/messages/${n.id}`}
      onNotificationOpen={(notification) => markNotificationRead.mutateAsync(notification.id)}
      onMarkAllRead={() => markAllNotificationsRead.mutateAsync()}
      isMarkingRead={markNotificationRead.isPending || markAllNotificationsRead.isPending}
    />
  )
}

function ModulesContent({
  children,
  firstOrgProfile,
}: {
  children: ReactNode
  firstOrgProfile: boolean
}) {
  const [isAIChatOpen, setIsAIChatOpen] = useState(false)
  const [isAIChatDocked, setIsAIChatDocked] = useState(false)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const workspaceProfile = useWorkspaceProfile()
  const messagesVisible = isWorkspaceSurfaceVisible(workspaceProfile, "messages")
  const journalVisible = isWorkspaceSurfaceVisible(workspaceProfile, "journal")
  const notebookVisible = isWorkspaceSurfaceVisible(workspaceProfile, "notebook")
  const { organizationId } = useErpSession()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const approvalInboxCountQuery = useApprovalInboxCount(
    orgId,
    orgReady && operatingCompanyId != null && operatingCompanyId > 0,
  )
  const currentUserProfile = useCurrentUserProfile()

  const navBadges = useMemo(() => {
    const badges: Record<string, number> = {}
    if (approvalInboxCountQuery.count > 0) badges["/approvals"] = approvalInboxCountQuery.count
    return Object.keys(badges).length > 0 ? badges : undefined
  }, [approvalInboxCountQuery.count])

  const openAiChat = useCallback(() => {
    setIsAIChatOpen(true)
  }, [])

  return (
    <ErpAiChatControllerProvider open={openAiChat}>
      <DashboardWorkspace
        forceCollapsed={(isAIChatOpen && isAIChatDocked) || isNotebookOpen}
        onOpenSearch={() => setIsSearchOpen(true)}
        notifications={orgReady && messagesVisible ? <HeaderNotificationBell organizationId={orgId} /> : null}
        sidebar={
          <DashboardSidebar
            firstOrgProfile={firstOrgProfile}
            forceCollapsed={(isAIChatOpen && isAIChatDocked) || isNotebookOpen}
            navBadges={navBadges}
            onOpenJournal={journalVisible ? () => setIsJournalOpen(true) : undefined}
            onOpenNotebook={notebookVisible ? () => setIsNotebookOpen(true) : undefined}
            onOpenAIChat={openAiChat}
            onSignOut={() => void performSignOut()}
            userProfile={currentUserProfile.data}
          />
        }
        overlays={
          <>
            <ErpAiChatPanel
              open={isAIChatOpen}
              onClose={() => {
                setIsAIChatOpen(false)
                setIsAIChatDocked(false)
              }}
              docked={isAIChatDocked}
              onDockToggle={() => setIsAIChatDocked((prev) => !prev)}
              config={{
                title: "Lumière Assistant",
                welcomeMessage: "Explore your business, prepare a draft, or turn an insight into a report.",
                placeholder: "Ask about your work or describe what you need...",
              }}
            />

            {notebookVisible && (
              <NotebookPanel
                open={isNotebookOpen}
                onClose={() => setIsNotebookOpen(false)}
                onAIChat={openAiChat}
                dataContext={{}}
              />
            )}

            {journalVisible && <JournalPanel open={isJournalOpen} onClose={() => setIsJournalOpen(false)} />}

            <ErpCommandPalette
              open={isSearchOpen}
              onOpenChange={setIsSearchOpen}
              firstOrgProfile={firstOrgProfile}
              recordHref={recordPageHref}
              onOpenAIChat={openAiChat}
              onOpenNotebook={notebookVisible ? () => setIsNotebookOpen(true) : undefined}
              onOpenJournal={journalVisible ? () => setIsJournalOpen(true) : undefined}
            />
          </>
        }
      >
        {children}
      </DashboardWorkspace>
    </ErpAiChatControllerProvider>
  )
}

export default function ModulesShell({
  children,
  firstOrgProfile = false,
}: {
  children: ReactNode
  firstOrgProfile?: boolean
}) {
  return (
    <WorkspaceProfileProvider value="finance-alpha">
      <AssistantGuideConversationProvider>
      <Suspense fallback={null}>
        <ErpAiRouteContextProvider>
          <ChatterUploaderProvider value={useWebChatterUploader}>
            <EntityCurrencyBoundary>
              <ModulesContent firstOrgProfile={firstOrgProfile}>{children}</ModulesContent>
            </EntityCurrencyBoundary>
          </ChatterUploaderProvider>
        </ErpAiRouteContextProvider>
      </Suspense>
      </AssistantGuideConversationProvider>
    </WorkspaceProfileProvider>
  )
}
