"use client"

import { WorkspaceProfileProvider, useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@lumiere/ui/components/button"
import { toast } from "sonner"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { ModuleActivity } from "../../components/module-activity"
import { NavigationEditorContext } from "@lumiere/ui/forms/navigation-guard-context"
import { AssistantNativeFormProvider, useAssistantNativeFormController, useAssistantNativeForms } from "@lumiere/ui/components/assistant-native-form-provider"
import { ALPHA_ASSISTANT_CAPABILITIES, ASSISTANT_PAGE_MODULES, assistantActionHref, decodeAssistantAction, getAssistantCapability, isAssistantPageAction, resolveAssistantActionRequest, type AssistantAction, type AssistantActionScope } from "@lumiere/query-hooks/assistant-actions"
import { ModulePageCompositionProvider, useModulePageComposition } from "@/lib/module-page-composition"
import {
  DashboardSidebar,
  DashboardWorkspace,
  ErpCommandPalette,
  AIChatPanel,
  ChatHistoryPanel,
  NotebookPanel,
  JournalPanel,
  ChatterUploaderProvider,
  NotificationBell,
  recentNotifications,
} from "@lumiere/ui"
import { ChatAlphaAnalytics } from "@/lib/chat-alpha-analytics"
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
  useUpdateAiChatSession,
  type AiChatHistoryReference,
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
  fetchAiActionDraftPayload,
} from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useApprovalInboxCount } from "@lumiere/query-hooks/hooks/approvals"
import { useRecordEvidenceContribution } from "@lumiere/query-hooks/hooks/ai-evidence-contributions"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useAiAgents } from "@lumiere/query-hooks/hooks/ai-agents"
import { chatAgentOptions } from "@/lib/chat-agent-options"
import { ErpAiRouteContextProvider, ErpAiChatControllerProvider, useErpAiRouteContext, useErpAiErrorQuestion } from "@/lib/erp-ai-context"
import { isAssistantErrorQuestion } from "@/lib/assistant-error-help"
import { AI_WORKSPACE_SCOPES, resolveAiWorkspaceScope } from "@/lib/ai-workspace-scope"
import { performSignOut } from "@/lib/auth-sign-out"
import {
  assistantAnswer, assistantAnswerMetadata, assistantSetupFailure, coordinateAssistantTurn,
  parseStoredAssistantRecovery, readAssistantStream, withAssistantRecoveryMetadata, type AssistantTurnFailure,
} from "@/lib/assistant-turn"
import { i18n } from "@lumiere/i18n"
import { assistantHistoryScope, saveAssistantHistory } from "@/lib/assistant-history"
import { assistantHistoryLink, useAssistantChatHistory } from "@/lib/use-assistant-chat-history"
import { useAssistantHistoryReferences } from "@/lib/use-assistant-history-references"
import { useChatImportTasks } from "@/lib/chat-import-tasks"
import {
  DocumentSelectionActionsContext, documentSelectionAnalysisReference,
  documentSelectionMatchesScope, documentSelectionPreparation,
  documentSelectionQuestion, readDocumentSelectionFile,
  type DocumentSelectionAction, type DocumentSelection, type DocumentSelectionDraft,
} from "@/lib/document-selection-actions"
import { DocumentViewerDialog } from "../../components/document-viewer-dialog"
import type { ImportPreparation } from "@/lib/import-preparation"

type SelectionImportHandler = (files: File[], preparation: ImportPreparation) => Promise<void>

import { recordPageHref } from "@/lib/record-page-href"
import { scopedImportTaskStatuses } from "@/lib/import-task-status"
import { assistantPresentationReply, modelNativeChatActions, parseNativeChatActions, withNativeActionsMetadata } from "@/lib/assistant-native-actions"
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
    instruction_trust: "untrusted",
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

const HISTORY_MODULES = [
  "accounting", "expenses", "reports", "sales", "crm", "purchasing", "subscriptions",
  "products", "warehouse", "fleet", "overview", "tasks", "approvals", "documents", "calendar", "settings", "ai-assistant",
] as const

function historyModuleLabel(module: string) {
  const label = AI_WORKSPACE_SCOPES.find(option => option.pathname === `/${module}`)?.label
  return label ?? (module === "ai-assistant" ? "AI Assistant" : module.charAt(0).toUpperCase() + module.slice(1))
}

function readStoredTurnId(raw?: string | null): string | undefined {
  if (!raw) return undefined
  try {
    const turnId = JSON.parse(raw)?.turnId
    return typeof turnId === "string" ? turnId : undefined
  } catch {
    return undefined
  }
}

function withStoredTurnMetadata(turnId: string, earlierContextUnavailable: boolean | undefined, raw: string | null) {
  return JSON.stringify({ ...(raw ? JSON.parse(raw) : {}), turnId, ...(earlierContextUnavailable && { earlierContextUnavailable }) })
}

function ErpAiChatPanel({
  firstOrgProfile,
  onRevealWorkspace,
  onRevealChat,
  selectionDraft,
  registerSelectionImport,
  ...props
}: Omit<ComponentProps<typeof AIChatPanel>, "onSendMessage" | "context"> & {
  firstOrgProfile: boolean
  onRevealWorkspace: () => void
  onRevealChat: () => void
  selectionDraft: DocumentSelectionDraft | null
  registerSelectionImport: (handler?: SelectionImportHandler) => () => void
}) {
  const { organizationId, identity } = useErpSession()
  const { route, module, activeTab, selection } = useErpAiRouteContext()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const router = useRouter()
  const workspaceProfile = useWorkspaceProfile()
  const { checkPermission, permissionsReady } = useRBAC()
  const navigationGuard = useContext(NavigationEditorContext)
  const nativeForms = useAssistantNativeForms()
  const pageComposition = useModulePageComposition()
  const actionScope = useMemo<AssistantActionScope | null>(() => identity && orgReady && operatingCompanyId
    ? { actorId: identity, organizationId: String(organizationId), companyId: String(operatingCompanyId) } : null,
  [identity, orgReady, organizationId, operatingCompanyId])
  const allowedActionModules = useMemo(() => [...new Set(ALPHA_ASSISTANT_CAPABILITIES.map(capability => capability.module))]
    .filter(moduleId => isWorkspaceSurfaceVisible(workspaceProfile, moduleId)), [workspaceProfile])
  const agentsQuery = useAiAgents(orgId, orgReady && operatingCompanyId != null)
  const chatAgents = useMemo(
    () => chatAgentOptions(agentsQuery.data ?? [], operatingCompanyId),
    [agentsQuery.data, operatingCompanyId],
  )
  const [selectedAgent, setSelectedAgent] = useState("default")
  useEffect(() => setSelectedAgent("default"), [organizationId, operatingCompanyId])
  const requestedAgentId = chatAgents.some(({ value }) => value === selectedAgent)
    ? Number(selectedAgent)
    : undefined
  const rag = useAiMemoryRag()
  const actionDraft = useAiActionDraft()
  const readScope = { actor: identity, organizationId: orgId, companyId: operatingCompanyId }
  const history = useAssistantChatHistory(readScope, props.open, onRevealChat)
  const actorHistoryScope = history.scope
  const sessionKey = history.sessionKey
  const historyScope = JSON.stringify([identity, organizationId, operatingCompanyId, sessionKey])
  const availableHistory = !history.unavailable && (!history.session.isError || Boolean(history.session.data))
  const [failedHistoryScope, setFailedHistoryScope] = useState<string | null>(null)
  const [, refreshSending] = useState(0)
  const inFlight = useRef(new Map<string, AbortController>())
  const currentHistoryScope = useRef(historyScope)
  currentHistoryScope.current = historyScope
  const currentActorHistory = useRef({ scope: actorHistoryScope })
  if (currentActorHistory.current.scope !== actorHistoryScope) currentActorHistory.current = { scope: actorHistoryScope }
  useEffect(() => {
    const requests = inFlight.current
    return () => {
      for (const controller of requests.values()) controller.abort()
      requests.clear()
    }
  }, [actorHistoryScope])
  const updateChatSession = useUpdateAiChatSession(readScope)
  const [rename, setRename] = useState<{ scope: string; title: string } | null>(null)
  const [historyCommandError, setHistoryCommandError] = useState<{ scope: string; message: string } | null>(null)
  const historyMessageIds = useMemo(() => history.messageRows.map(row => String(row.id)), [history.messageRows])
  const {
    historyRefs, renderMessageActions, composerContext, referenceOverlay, clearReferences, renderCitation, renderImportDecision,
  } = useAssistantHistoryReferences({
    scopeKey: actorHistoryScope,
    sessionKey,
    companyId: operatingCompanyId,
    onNewChat: history.newChat,
    onOpenMessage: history.openMessage,
    messageIds: historyMessageIds,
    readonly: history.archived || !availableHistory,
  })
  const [selectedScope, setSelectedScope] = useState("current")
  const [openGuide, setOpenGuide] = useState<{ scope: string; request: OpenGuideRequest } | null>(null)
  const guideConversation = useAssistantGuideConversation()
  const errorQuestion = useErpAiErrorQuestion()
  const appliedComposerRequests = useRef({ scope: actorHistoryScope, ids: new Set<string>() })
  if (appliedComposerRequests.current.scope !== actorHistoryScope) {
    appliedComposerRequests.current = { scope: actorHistoryScope, ids: new Set() }
  }
  const markComposerRequestApplied = useCallback((id: string) => {
    const { ids } = appliedComposerRequests.current
    ids.add(id)
    if (ids.size > 8) {
      const first = ids.values().next().value
      if (first) ids.delete(first)
    }
  }, [])
  const revealWorkspace = useRef(onRevealWorkspace)
  revealWorkspace.current = onRevealWorkspace
  const activeScope = useRef<string | null>(null)
  activeScope.current = actorHistoryScope
  const currentActionContext = useRef({ actionScope, actorHistoryScope, checkPermission, permissionsReady, allowedActionModules, pageComposition })
  currentActionContext.current = { actionScope, actorHistoryScope, checkPermission, permissionsReady, allowedActionModules, pageComposition }
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
  const companiesQuery = useCompanies(orgId, orgReady)
  const importTasks = useChatImportTasks({ identity, organizationId: orgId, companyId: operatingCompanyId, conversationKey: sessionKey, renderHistoryDecision: renderImportDecision, readonly: history.archived || !availableHistory })
  useEffect(() => registerSelectionImport(importTasks.onImportFiles), [importTasks.onImportFiles, registerSelectionImport])
  const [sourcePreview, setSourcePreview] = useState<{ scope: string; documentId: string; versionId: string } | null>(null)
  const scopedSelectionDraft = selectionDraft?.scope === actorHistoryScope ? selectionDraft : null
  const importCompany = companiesQuery.data?.find(company => String(company.id) === String(operatingCompanyId))
  const composerRequest = errorQuestion ?? scopedSelectionDraft
  const pendingComposerRequest = composerRequest && sessionKey && !appliedComposerRequests.current.ids.has(composerRequest.id)
    ? composerRequest
    : null

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

  const initialMessages = useMemo((): ChatMessage[] => {
    if (!sessionKey || !actorHistoryScope || !availableHistory) return []
    return history.messageRows.filter((row) => String(row.organizationId ?? row.organization_id) === String(orgId)
      && String(row.companyId ?? row.company_id) === String(operatingCompanyId)).map((row) => ({
      id: String(row.id),
      role:
        row.role === "user" || row.role === "assistant" || row.role === "system"
          ? row.role
          : "assistant",
      content: row.content,
      timestamp: dateFromStored(row.createDate ?? row.create_date),
      sources: parseStoredSources(row.sourcesJson ?? row.sources_json),
      actions: [...(parseStoredChatActions(row.metadata) ?? []), ...parseNativeChatActions(row.metadata, actionScope)] as ChatAction[],
      guides: parseStoredGuideReferences(row.metadata),
      recoveryPath: parseStoredAssistantRecovery(row.metadata),
      metadata: {
        model: row.model ?? undefined,
        duration:
          row.durationMs != null
            ? Number(row.durationMs)
            : row.duration_ms != null
              ? Number(row.duration_ms)
              : undefined,
        runId: parseStoredChatRunId(row.metadata),
        companyId: operatingCompanyId ?? undefined,
        turnId: row.turnId || readStoredTurnId(row.metadata),
        historyTruncated: row.historyTruncated === true,
      },
    }))
  }, [availableHistory, history.messageRows, sessionKey, actorHistoryScope, orgId, operatingCompanyId, actionScope])

  const ensureSession = useCallback(async (question?: string) => {
    if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) throw new Error("Conversation context is unavailable")
    if (history.archived || !availableHistory) throw new Error("Restore or reopen this conversation before sending.")
    if (history.session.data) return
    await createSession.mutateAsync({
        session_key: sessionKey,
        title: question?.trim().replace(/\s+/g, " ").slice(0, 80) || "Lumière Assistant",
        route,
        module: module ?? null,
        active_tab: activeTab ?? null,
    })
  }, [activeTab, createSession, history.archived, history.session.data, availableHistory, operatingCompanyId, module, orgReady, route, sessionKey])

  const persistExchange = useCallback(
    async (args: {
      userText: string
      assistantText: string
      turnId: string
      historyRefs?: readonly AiChatHistoryReference[]
      earlierContextUnavailable?: boolean
      actorRequest: { scope: string | null }
      sources: ChatMessageSourceRef[]
      uiContext: unknown
      durationMs?: number
      model?: string | null
      actions?: ChatAction[]
      runId?: number
      guides?: GuideReference[]
      recoveryPath?: ChatMessage["recoveryPath"]
    }) => {
      if (!sessionKey || !orgReady || operatingCompanyId == null || operatingCompanyId <= 0) return
      const { actorRequest } = args
      if (currentActorHistory.current !== actorRequest) return
      const result = await saveAssistantHistory({
        ensureSession: async () => undefined,
        isCurrent: () => currentActorHistory.current === actorRequest,
        appendUser: async () => { await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "user",
          content: args.userText,
          ui_context_json: JSON.stringify(args.uiContext ?? null),
          metadata: JSON.stringify({ turnId: args.turnId, ...(args.historyRefs?.length ? { historyRefs: args.historyRefs } : {}) }),
        }) },
        appendAssistant: async () => { await appendMessage.mutateAsync({
          session_key: sessionKey,
          role: "assistant",
          content: args.assistantText,
          sources_json: JSON.stringify(args.sources),
          ui_context_json: JSON.stringify(args.uiContext ?? null),
          model: args.model ?? null,
          duration_ms: args.durationMs ?? null,
          metadata: withStoredTurnMetadata(args.turnId, args.earlierContextUnavailable, withAssistantRecoveryMetadata(
            withGuideReferencesMetadata(
              withNativeActionsMetadata(
                args.actions?.length || args.runId != null
                  ? chatActionsToMetadata(
                      (args.actions ?? []).filter(
                        (action): action is Extract<ChatAction, { type: "draft" }> =>
                          action.type === "draft" && action.draft != null,
                      ),
                      args.runId,
                    )
                  : null,
                args.actions,
              ),
              args.guides,
            ),
            args.recoveryPath,
          )),
        }) },
      })
      if (result === "failed") setFailedHistoryScope(historyScope)
    },
    [appendMessage, operatingCompanyId, orgReady, sessionKey, historyScope],
  )

  const buildRequestContext = useCallback(
    (userText: string, questionGuide?: GuideDraft) => {
      const guideContext = questionGuide ? guideQuestionContext(questionGuide) : undefined
      const atCommands = [...new Set([...parseAtCommands(userText), ...(guideContext?.commands ?? workspaceScope.commands)])]
      const page = !guideContext && workspaceScope.usesCurrentPage && pageComposition?.page?.moduleId === module
        ? pageComposition.page : undefined
      const requestSelection = guideContext ? guideContext.selection : workspaceScope.selection
      return {
        atCommands,
        includeTypes: atCommandsToIncludeTypes(atCommands),
        uiContext: buildAiUiContext({
          pathname: guideContext?.pathname ?? workspaceScope.pathname,
          companyId: operatingCompanyId,
          activeTab: guideContext ? guideContext.activeTab : page?.pageId ?? (workspaceScope.usesCurrentPage ? activeTab : null),
          atCommands,
          selection: requestSelection && page?.pageId ? { ...requestSelection, activeTab: page.pageId } : requestSelection,
        }),
      }
    },
    [activeTab, operatingCompanyId, workspaceScope, pageComposition?.page, module],
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
      enableFileUpload: true,
      actionDraftScopeKey: actorHistoryScope ?? undefined,
      guideLibraryHref: operatingCompanyId ? guideLibraryHref(String(operatingCompanyId), module ?? undefined) : undefined,
      onOpenGuide: (request: OpenGuideRequest) => {
        if (actorHistoryScope) setOpenGuide({ scope: historyScope, request })
      },
      onApproveActionDraft: async (draft: { draftId: number; companyId?: number }) => {
        return approveActionDraft.mutateAsync({
          draftId: draft.draftId,
          companyId: draft.companyId,
        })
      },
      onRejectActionDraft: async (
        draft: { draftId: number; companyId?: number },
        reason?: string,
      ) => {
        return rejectActionDraft.mutateAsync({
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
        return updateActionDraft.mutateAsync({
          draftId: draft.draftId,
          paramsJson: JSON.stringify(draft.paramsJson),
          summary: draft.summary,
          companyId: draft.companyId,
        })
      },
      onRefreshActionDraft: async (draft: { draftId: number; companyId?: number }) => {
        if (!operatingCompanyId || (draft.companyId != null && draft.companyId !== operatingCompanyId)) throw new Error("Draft scope changed")
        return fetchAiActionDraftPayload(orgId, operatingCompanyId, draft.draftId)
      },
      onNativeAction: (proposed: AssistantAction, messageId: string) => {
        const validate = () => {
          const current = currentActionContext.current
          const action = current.actionScope && decodeAssistantAction(proposed, current.actionScope, { allowedModules: current.allowedActionModules, allowedPageModules: ASSISTANT_PAGE_MODULES })
          const capability = action && getAssistantCapability(action.capabilityKey)
          if (!action || !capability || !current.actorHistoryScope) throw new Error(i18n.t("aiChat.native.scopeChanged"))
          if (!current.permissionsReady || !current.checkPermission(capability.permission.resource, capability.permission.action).allowed) throw new Error(i18n.t("aiChat.native.denied"))
          return { action, capability, scopeKey: current.actorHistoryScope }
        }
        const initial = validate()
        const currentPage = currentActionContext.current.pageComposition?.page
        const changesPage = !isAssistantPageAction(initial.action) || currentPage?.moduleId !== initial.capability.module || Boolean(initial.action.pageId && currentPage?.pageId !== initial.action.pageId)
        const open = () => {
          try {
            const { action, capability, scopeKey } = validate()
            const href = assistantActionHref(action)
            if (!href) throw new Error(i18n.t("aiChat.native.formUnavailable"))
            if (isAssistantPageAction(action)) {
              const composer = currentActionContext.current.pageComposition
              if (!composer) throw new Error(i18n.t("aiChat.native.pageUnavailable"))
              const origin = action.kind === "add_widget" && !action.widgetKey && sessionKey && /^[1-9][0-9]{0,19}$/.test(messageId)
                ? { sessionKey, messageId } : undefined
              const result = composer.requestPage({ requestId: crypto.randomUUID(), scopeKey, moduleId: capability.module, pageId: action.pageId, kind: action.kind, widgetKey: action.widgetKey, prompt: action.prompt, origin })
              if (result !== "pending") throw new Error(i18n.t(result === "busy" ? "aiChat.native.pageBusy" : "aiChat.native.scopeChanged"))
              // Preserve the current date range and filters when opening this page's editor.
              if (composer.page?.moduleId !== capability.module || (action.pageId && composer.page.pageId !== action.pageId)) router.push(href)
            } else if (action.kind === "open_form") {
              if (!nativeForms || !capability.tab) throw new Error(i18n.t("aiChat.native.formUnavailable"))
              const result = nativeForms.requestForm({ requestId: crypto.randomUUID(), scopeKey, moduleId: capability.module, tabId: capability.tab, prompt: action.prompt })
              if (result !== "pending") throw new Error(i18n.t(result === "busy" ? "aiChat.native.formBusy" : "aiChat.native.scopeChanged"))
            }
            if (!isAssistantPageAction(action)) router.push(href)
            revealWorkspace.current()
          } catch (error) { toast.error(error instanceof Error ? error.message : i18n.t("aiChat.native.openFailed")) }
        }
        if (changesPage && navigationGuard) navigationGuard.proceed(open)
        else open()
      },
      onOpenDocumentSource: (source: ChatMessageSourceRef) => {
        if (!actorHistoryScope || source.source_kind !== "managed_document_selection" ||
          !source.entity_id || !source.source_version ||
          !/^[1-9]\d*$/.test(source.entity_id) || !/^[1-9]\d*$/.test(source.source_version)) return
        setSourcePreview({ scope: actorHistoryScope, documentId: source.entity_id, versionId: source.source_version })
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
      historyScope,
      citeSource,
      operatingCompanyId,
      props.config,
      rejectActionDraft,
      sessionKey,
      updateActionDraft,
      module,
      orgId,
      nativeForms,
      navigationGuard,
      router,
    ],
  )

  const runTurn = useCallback(
    async (
      userText: string,
      stream: boolean,
      signal: AbortSignal,
      guideRefs?: GuideReference[],
      questionGuide?: GuideDraft,
      hasUnsavedGuideEdits = false,
      turnId: string = crypto.randomUUID(),
    ) => {
      if (!orgReady || operatingCompanyId == null || operatingCompanyId <= 0) {
        return {
          content: companiesQuery.isLoading
            ? i18n.t("aiChat.turn.loadingCompany")
            : i18n.t("aiChat.turn.companyRequired"),
          sources: [] as ChatMessageSourceRef[],
        }
      }
      if (!sessionKey || !actorHistoryScope || history.archived || !availableHistory) throw new Error("Open an active conversation before sending.")
      if (new TextEncoder().encode(userText).length > 8 * 1024) {
        throw new Error(i18n.t("aiChat.history.inputTooLarge", { defaultValue: "Shorten your message before sending. You can attach a file separately." }))
      }
      const actorRequest = currentActorHistory.current
      const isCurrent = () => !signal.aborted && currentActorHistory.current === actorRequest
      const selectedReferences = questionGuide ? undefined : historyRefs
      const turnMeta = { turnId, actorRequest, historyRefs: selectedReferences }
      const started = performance.now()
      const continuity = { chat_session_key: sessionKey, history_refs: selectedReferences?.length ? [...selectedReferences] : undefined }
      await ensureSession(userText)
      if (!isCurrent()) throw new Error("The conversation company changed.")
      const selectedDocument = !questionGuide && scopedSelectionDraft && userText.includes(scopedSelectionDraft.text)
        ? scopedSelectionDraft
        : null
      if (selectedDocument) {
        if (!documentSelectionMatchesScope(selectedDocument.selection, orgId, operatingCompanyId)) {
          throw new Error("The company changed. Reopen the file before asking.")
        }
        if (selectedAgent !== "default" && requestedAgentId == null) {
          throw new Error("The selected AI agent is no longer available. Choose another agent.")
        }
        try {
          const answer = await rag.mutateAsync({
            query: selectedDocument.action === "explain"
              ? "Explain the selected spreadsheet cells."
              : "Check the selected spreadsheet cells for issues.",
            companyId: operatingCompanyId,
            ...continuity,
            signal,
            spreadsheet_selection: documentSelectionAnalysisReference(selectedDocument.selection),
            ...(requestedAgentId ? { agent_id: requestedAgentId } : {}),
          })
          if (!isCurrent()) return { content: "", sources: [] as ChatMessageSourceRef[] }
          const sources = answer.sources.map(mapRagSourceToChatSource)
          await persistExchange({ ...turnMeta, userText, assistantText: answer.answer, sources, uiContext: null, runId: answer.run_id })
          if (selectedReferences?.length && isCurrent()) clearReferences(sessionKey)
          return { content: answer.answer, sources, runId: answer.run_id, earlierContextUnavailable: answer.earlier_context_unavailable }
        } catch (error) {
          if (!isCurrent()) return { content: "", sources: [] as ChatMessageSourceRef[] }
          const setup = assistantSetupFailure(error)
          if (!setup) throw error
          return { content: setup.message, recoveryPath: setup.recoveryPath, sources: [] as ChatMessageSourceRef[] }
        }
      }
      const { includeTypes, uiContext } = buildRequestContext(userText, questionGuide)
      const turnPage = !questionGuide && workspaceScope.usesCurrentPage && pageComposition?.page?.moduleId === module ? pageComposition.page : undefined
      const focusedImport = importTasks.focusedTask
      const importTaskRefs = focusedImport?.companyId === String(operatingCompanyId)
        ? [{ taskId: focusedImport.requestId, companyId: focusedImport.companyId }]
        : undefined
      let presentationResolution = !questionGuide && !selectedReferences?.length && !isAssistantErrorQuestion(userText) && actionScope
        ? resolveAssistantActionRequest(userText, {
          scope: actionScope,
          module: workspaceScope.usesCurrentPage ? module : workspaceScope.pathname.split("/")[1],
          selection: workspaceScope.selection,
          allowedModules: allowedActionModules,
          allowedPageModules: ASSISTANT_PAGE_MODULES,
          page: turnPage,
        }) : undefined
      if (presentationResolution?.kind === "action") {
        const capability = getAssistantCapability(presentationResolution.action.capabilityKey)
        if (!capability || !permissionsReady || !checkPermission(capability.permission.resource, capability.permission.action).allowed) {
          presentationResolution = { kind: "clarify", reason: "unavailable", candidates: [] }
        }
      }
      const presentation = presentationResolution ? assistantPresentationReply(presentationResolution, (key) => i18n.t(key)) : undefined
      if (presentation) {
        await persistExchange({ ...turnMeta, userText, assistantText: presentation.content, sources: presentation.sources, uiContext, actions: presentation.actions })
        return presentation
      }
      const turn = await coordinateAssistantTurn({
        isCurrent,
        answer: async () => {
          if (selectedAgent !== "default" && requestedAgentId == null) {
            throw new Error("The selected AI agent is no longer available. Choose another agent.")
          }
          if (!stream) return assistantAnswer(await rag.mutateAsync({
            query: questionGuide ? guideDraftQuestion(questionGuide, userText, hasUnsavedGuideEdits) : userText, companyId: operatingCompanyId,
            ...continuity,
            signal,
            include_types: includeTypes, ui_context: uiContext, guide_refs: guideRefs, import_task_refs: importTaskRefs,
            ...(requestedAgentId ? { agent_id: requestedAgentId } : {}),
          }))
          const response = await fetch("/api/ai/rag/stream", {
            signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: questionGuide ? guideDraftQuestion(questionGuide, userText, hasUnsavedGuideEdits) : userText, companyId: operatingCompanyId,
              ...continuity,
              ...(requestedAgentId ? { agent_id: requestedAgentId } : {}),
              ...(includeTypes.length ? { include_types: includeTypes } : {}),
              ...(uiContext ? { ui_context: uiContext } : {}),
              ...(guideRefs?.length ? { guide_refs: guideRefs } : {}),
              ...(importTaskRefs?.length ? { import_task_refs: importTaskRefs } : {}),
            }),
          })
          // Never fall back after dispatch: a missing reply does not prove no run occurred.
          return readAssistantStream(response, (data) => assistantAnswerMetadata(JSON.parse(data)))
        },
        drafts: !questionGuide && !selectedReferences?.length && !isAssistantErrorQuestion(userText) && looksLikeActionDraftRequest(userText) ? () => resolveActionDrafts(userText, uiContext) : undefined,
      })
      if ("kind" in turn) return { content: "", sources: [] as ChatMessageSourceRef[] }
      const out = turn.answer.kind === "ready" ? turn.answer.value : undefined
      const sources = (out?.sources ?? []).map(mapRagSourceToChatSource)
      const guides = out?.guides
      const taskStatuses = scopedImportTaskStatuses(out?.importTasks, { organizationId: orgId, companyId: operatingCompanyId, taskIds: importTaskRefs?.map(reference => reference.taskId) ?? [] })
      const draftActions = turn.drafts.kind === "ready" ? turn.drafts.value : []
      const nativeActions = actionScope ? modelNativeChatActions(out?.ui_actions ?? [], actionScope, userText, turnPage)
        .filter(action => {
          const capability = action.nativeAction && getAssistantCapability(action.nativeAction.capabilityKey)
          return capability && (isAssistantPageAction(action.nativeAction!) || allowedActionModules.includes(capability.module)) && permissionsReady && checkPermission(capability.permission.resource, capability.permission.action).allowed
        }) : []
      const actions = [...draftActions, ...nativeActions]
      const failureText = (phase: "answer" | "draft", failure: AssistantTurnFailure) =>
        failure.setup?.message ?? failure.retryMessage ?? i18n.t(`aiChat.turn.${phase}.${failure.kind}`)
      if (turn.answer.kind !== "ready" && !turn.answer.setup && turn.drafts.kind === "not_requested") {
        throw new Error(failureText("answer", turn.answer))
      }
      const parts = [turn.answer.kind === "ready" ? turn.answer.value.answer : failureText("answer", turn.answer)]
      const answerRecovery = turn.answer.kind !== "ready" ? turn.answer.setup : undefined
      const draftRecovery = turn.drafts.kind !== "ready" && turn.drafts.kind !== "not_requested" ? turn.drafts.setup : undefined
      if (turn.drafts.kind === "ready") {
        parts.push(draftActions.length ? i18n.t("aiChat.turn.reviewDrafts") : i18n.t("aiChat.turn.noDraft"))
      } else if (turn.drafts.kind !== "not_requested" && (!draftRecovery || draftRecovery.code !== answerRecovery?.code)) {
        parts.push(failureText("draft", turn.drafts))
      }
      const recoveryPath = answerRecovery?.recoveryPath ?? draftRecovery?.recoveryPath
      const content = parts.join("\n\n")
      await persistExchange({
        ...turnMeta,
        userText, assistantText: content, sources, uiContext, guides,
        earlierContextUnavailable: out?.earlierContextUnavailable,
        durationMs: Math.round(performance.now() - started), model: out?.model ?? null,
        actions: actions.length ? actions : undefined, runId: out?.run_id, recoveryPath,
      })
      if (out && selectedReferences?.length && isCurrent()) clearReferences(sessionKey)
      return { content, runId: out?.run_id, sources, guides, recoveryPath, importTasks: taskStatuses, actions: actions.length ? actions : undefined, earlierContextUnavailable: out?.earlierContextUnavailable }
    },
    [orgId, orgReady, operatingCompanyId, selectedAgent, requestedAgentId, companiesQuery.isLoading, sessionKey, actorHistoryScope, history.archived, availableHistory, historyRefs, clearReferences, ensureSession, buildRequestContext, rag, resolveActionDrafts, persistExchange, actionScope, workspaceScope, module, allowedActionModules, permissionsReady, checkPermission, pageComposition?.page, importTasks.focusedTask, scopedSelectionDraft],
  )
  const sendTurn = useCallback(async (text: string, stream: boolean, turnId?: string, guideRefs?: GuideReference[], guide?: GuideDraft, hasUnsavedGuideEdits = false) => {
    if (inFlight.current.has(historyScope) || inFlight.current.size >= 2) {
      throw new Error(i18n.t("aiChat.history.waitForReply", { defaultValue: "Wait for an Assistant response to finish before sending another message." }))
    }
    const controller = new AbortController()
    inFlight.current.set(historyScope, controller)
    refreshSending(version => version + 1)
    try {
      return await runTurn(text, stream, controller.signal, guideRefs, guide, hasUnsavedGuideEdits, turnId)
    } finally {
      if (inFlight.current.get(historyScope) === controller) {
        inFlight.current.delete(historyScope)
        refreshSending(version => version + 1)
      }
    }
  }, [historyScope, runTurn])
  const onSendMessage = useCallback((text: string, turnId?: string) => sendTurn(text, false, turnId), [sendTurn])
  const onStreamMessage = useCallback<NonNullable<ComponentProps<typeof AIChatPanel>["onStreamMessage"]>>(
    async (text, handlers) => {
      const reply = await sendTurn(text, true, handlers.turnId)
      handlers.onDelta(reply.content)
      handlers.onSources(reply.sources)
      if (reply.actions) handlers.onActions?.(reply.actions)
      return reply
    }, [sendTurn],
  )

  const onGuideSaved = useCallback(async (guide: GuideDocument) => {
    const scope = currentActorHistory.current
    if (scope.scope !== actorHistoryScope || currentHistoryScope.current !== historyScope ||
      !sessionKey || !orgReady || operatingCompanyId == null || guide.companyId !== String(operatingCompanyId)) {
      throw new Error("The conversation scope changed")
    }
    await ensureSession()
    if (currentActorHistory.current !== scope || currentHistoryScope.current !== historyScope) throw new Error("The conversation scope changed")
    await appendMessage.mutateAsync({
      session_key: sessionKey,
      role: "assistant",
      content: "Saved a guide to the current company's knowledge library.",
      sources_json: "[]",
      metadata: guideReferencesMetadata(guide),
    })
  }, [appendMessage, ensureSession, operatingCompanyId, orgReady, sessionKey, actorHistoryScope, historyScope])

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
    const reply = await sendTurn(question, false, undefined, references, currentGuide, Boolean(draftOverride))
    if (activeScope.current !== scope) throw new Error("The company changed while answering. Reopen the guide in the current company.")
    return reply.content
  }, [sendTurn, operatingCompanyId, actorHistoryScope, sessionKey])

  useEffect(() => guideConversation.register(askAboutGuide), [guideConversation.register, askAboutGuide])

  const conversation = availableHistory ? history.session.data : undefined
  const conversationTitle = conversation?.title?.trim() || i18n.t("aiChat.history.untitled", { defaultValue: "Untitled conversation" })
  const openRename = rename?.scope === historyScope ? rename : null
  const visibleHistoryError = historyCommandError?.scope === historyScope ? historyCommandError.message : null
  const setHistoryOpen = (open: boolean) => history.updateFilters({ open })
  const changeConversation = async (change: { archived: boolean } | { title: string }) => {
    if (!sessionKey || !conversation || inFlight.current.has(historyScope) || currentHistoryScope.current !== historyScope) return
    setHistoryCommandError(null)
    try {
      await updateChatSession.mutateAsync({ sessionKey, ...change })
      if (currentHistoryScope.current === historyScope) setRename(null)
    } catch (error) {
      if (currentHistoryScope.current === historyScope) setHistoryCommandError({
        scope: historyScope,
        message: error instanceof Error ? error.message : i18n.t("aiChat.history.updateFailed", { defaultValue: "The conversation could not be updated." }),
      })
    }
  }
  const historyActions = conversation ? (
    <div className="min-w-0 space-y-1">
      {openRename ? (
        <form className="flex flex-wrap items-center gap-1" onSubmit={event => {
          event.preventDefault()
          if (openRename.title.trim()) void changeConversation({ title: openRename.title.trim() })
        }}>
          <label className="sr-only" htmlFor="assistant-thread-title">{i18n.t("aiChat.history.threadTitle", { defaultValue: "Conversation title" })}</label>
          <input id="assistant-thread-title" value={openRename.title} maxLength={80} autoFocus
            className="h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-sm"
            onChange={event => setRename({ scope: historyScope, title: event.target.value })}
          />
          <Button size="sm" type="submit" disabled={!openRename.title.trim() || updateChatSession.isPending}>{i18n.t("common.save")}</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRename(null)}>{i18n.t("common.cancel")}</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" disabled={updateChatSession.isPending || inFlight.current.has(historyScope)}
            onClick={() => setRename({ scope: historyScope, title: conversationTitle })}>{i18n.t("aiChat.history.rename", { defaultValue: "Rename" })}</Button>
          <Button size="sm" variant="ghost" disabled={updateChatSession.isPending || inFlight.current.has(historyScope)}
            onClick={() => { void changeConversation({ archived: !history.archived }) }}>
            {history.archived ? i18n.t("aiChat.history.restore", { defaultValue: "Restore" }) : i18n.t("aiChat.history.archive", { defaultValue: "Archive" })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (!operatingCompanyId || !sessionKey) return
            const href = assistantHistoryLink({ companyId: operatingCompanyId, sessionKey })
            void navigator.clipboard.writeText(new URL(href, window.location.origin).href).then(
              () => toast.success(i18n.t("aiChat.history.linkCopied", { defaultValue: "Conversation link copied." })),
              () => toast.error(i18n.t("aiChat.history.linkFailed", { defaultValue: "The conversation link could not be copied." })),
            )
          }}>{i18n.t("aiChat.history.copyLink", { defaultValue: "Copy link" })}</Button>
        </div>
      )}
      {visibleHistoryError ? <p role="alert" className="max-w-full break-words text-xs text-destructive">{visibleHistoryError}</p> : null}
    </div>
  ) : null
  const historyModules = HISTORY_MODULES
    .filter(name => isWorkspaceSurfaceVisible(workspaceProfile, name))
    .map(value => ({ value, label: historyModuleLabel(value) }))
  const historyEntries = (history.listUnavailable ? [] : history.list.data?.pages ?? []).flatMap(page => page.data).flatMap(row => {
    const key = row.sessionKey ?? row.session_key
    if (!key) return []
    const date = row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date
    return [{
      key,
      title: row.title?.trim() || i18n.t("aiChat.history.untitled", { defaultValue: "Untitled conversation" }),
      moduleLabel: row.module ? historyModuleLabel(row.module) : undefined,
      timestamp: date != null ? dateFromStored(date).toLocaleDateString(i18n.language, { month: "short", day: "numeric" }) : undefined,
      excerpt: row.searchSnippet ?? undefined,
      messageId: row.searchMessageId ?? undefined,
    }]
  })

  return (
    <AIChatPanel
      key={JSON.stringify([identity, organizationId, operatingCompanyId])}
      {...props}
      config={chatConfig}
      context={chatContext}
      initialMessages={initialMessages}
      conversationKey={historyScope}
      draft={history.draft}
      sendPending={inFlight.current.has(historyScope)}
      renderMessageActions={renderMessageActions}
      renderCitation={renderCitation}
      composerContext={composerContext}
      history={actorHistoryScope ? {
        open: history.filters.open,
        onToggle: () => setHistoryOpen(!history.filters.open),
        title: conversation ? conversationTitle : undefined,
        actions: historyActions,
        archived: history.archived,
        unavailable: !availableHistory,
        loading: history.session.isFetching || (Boolean(conversation) && history.messages.isPending),
        error: history.session.isError || history.messages.isError || history.anchorMissing,
        onRetry: () => {
          void history.session.refetch()
          if (history.session.data) void history.messages.refetch()
        },
        onLoadOlder: history.messages.hasNextPage ? () => history.messages.fetchNextPage({ throwOnError: true }) : undefined,
        loadingOlder: history.messages.isFetchingNextPage,
        onLatest: history.messages.hasEvictedLatest ? history.messages.resetToLatest : undefined,
        anchorMessageId: history.anchorMessageId,
        content: <ChatHistoryPanel
          entries={historyEntries}
          selectedKey={sessionKey}
          archived={history.filters.archived}
          onArchivedChange={archived => history.updateFilters({ archived })}
          search={history.filters.search}
          onSearchChange={search => history.updateFilters({ search })}
          module={history.filters.module}
          modules={historyModules}
          onModuleChange={module => history.updateFilters({ module })}
          onSelect={entry => history.selectThread(entry.key, entry.messageId)}
          onNewChat={history.newChat}
          onBack={() => setHistoryOpen(false)}
          loading={history.list.isPending || history.list.isFetchingNextPage}
          error={history.list.isError}
          onRetry={() => { void history.list.refetch() }}
          onMore={history.list.hasNextPage ? () => { void history.list.fetchNextPage() } : undefined}
          actions={historyActions}
        />,
      } : undefined}
      composerRequest={pendingComposerRequest}
      onComposerRequestApplied={markComposerRequestApplied}
      modal={Boolean(errorQuestion)}
      historySaveFailed={failedHistoryScope === historyScope}
      overlayContent={<>
        {availableHistory ? referenceOverlay : null}
        <AssistantGuideHost request={availableHistory ? guideRequestInScope(openGuide, historyScope) : null} organizationId={orgId} companyId={operatingCompanyId ?? undefined}
          onClose={() => setOpenGuide(null)} onSaved={onGuideSaved} onAsk={askAboutGuide} />
        {sourcePreview?.scope === actorHistoryScope && organizationId ? (
          <DocumentViewerDialog organizationId={BigInt(organizationId)} documentId={sourcePreview.documentId}
            versionId={sourcePreview.versionId} onOpenChange={open => { if (!open) setSourcePreview(null) }} />
        ) : null}
      </>}
      contextOptions={AI_WORKSPACE_SCOPES}
      selectedContext={selectedScope}
      onContextChange={setSelectedScope}
      agentOptions={chatAgents}
      selectedAgent={selectedAgent}
      onAgentChange={setSelectedAgent}
      onSendMessage={onSendMessage}
      onStreamMessage={onStreamMessage}
      onImportFiles={importTasks.onImportFiles}
      importFileNames={importTasks.fileNames}
      showWorkbench={!firstOrgProfile && permissionsReady && checkPermission("dashboard:analytics", "read").allowed}
      importTaskContent={<>
        {orgReady && identity && operatingCompanyId ? (
          <ChatAlphaAnalytics key={JSON.stringify([identity, orgId, operatingCompanyId, sessionKey])}
            companyId={operatingCompanyId} companyName={importCompany?.name} />
        ) : null}
        {importTasks.content}
      </>}
      importCompanyLabel={importCompany?.name ?? (operatingCompanyId ? `Company ${operatingCompanyId}` : undefined)}
      importScopeKey={JSON.stringify([identity, organizationId, operatingCompanyId, sessionKey])}
    />
  )
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
  const [workspaceTool, setWorkspaceTool] = useState<"assistant" | "notebook" | null>(null)
  const [isAIChatDocked, setIsAIChatDocked] = useState(true)
  const [isNotebookDocked, setIsNotebookDocked] = useState(true)
  const [isJournalOpen, setIsJournalOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const workspaceProfile = useWorkspaceProfile()
  const messagesVisible = isWorkspaceSurfaceVisible(workspaceProfile, "messages")
  const journalVisible = isWorkspaceSurfaceVisible(workspaceProfile, "journal")
  const notebookVisible = isWorkspaceSurfaceVisible(workspaceProfile, "notebook")
  const isAIChatOpen = workspaceTool === "assistant"
  const isNotebookOpen = notebookVisible && workspaceTool === "notebook"
  const dockRequest = isAIChatOpen && isAIChatDocked
    ? "assistant"
    : isNotebookOpen && isNotebookDocked ? "notebook" : null
  const { organizationId, identity } = useErpSession()
  const orgId = organizationId ?? 0
  const orgReady = organizationId != null && organizationId > 0
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const nativeFormScope = assistantHistoryScope(identity, organizationId, operatingCompanyId)
  const nativeForms = useAssistantNativeFormController(nativeFormScope)
  useEffect(() => {
    const status = nativeForms.outcome?.status
    if (status === "opened") toast.info(i18n.t("aiChat.native.formOpened"))
    else if (status) toast.warning(i18n.t(status === "busy" ? "aiChat.native.formBusy" : "aiChat.native.formUnavailable"))
  }, [nativeForms.outcome])
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
    setIsAIChatDocked(true)
    setWorkspaceTool("assistant")
  }, [])
  const openNotebook = () => setWorkspaceTool("notebook")
  const closeTool = (tool: "assistant" | "notebook") =>
    setWorkspaceTool((current) => current === tool ? null : current)

  const [selectionDraft, setSelectionDraft] = useState<DocumentSelectionDraft | null>(null)
  const selectionImport = useRef<SelectionImportHandler | undefined>(undefined)
  const currentSelectionScope = useRef({ scope: nativeFormScope })
  if (currentSelectionScope.current.scope !== nativeFormScope) currentSelectionScope.current = { scope: nativeFormScope }
  useEffect(() => setSelectionDraft(current => current?.scope === nativeFormScope ? current : null), [nativeFormScope])
  const registerSelectionImport = useCallback((handler?: SelectionImportHandler) => {
    selectionImport.current = handler
    return () => { if (selectionImport.current === handler) selectionImport.current = undefined }
  }, [])
  const onDocumentSelectionAction = useCallback(async (
    action: DocumentSelectionAction, selection: DocumentSelection, signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted()
    const currentScope = currentSelectionScope.current
    if (!nativeFormScope || currentScope.scope !== nativeFormScope ||
      !documentSelectionMatchesScope(selection, organizationId, operatingCompanyId)) {
      throw new Error("Open the file in the current company to continue.")
    }
    if (!selection.source.versionId) throw new Error("The selected file has no saved version.")
    if (action === "prepare") {
      const handler = selectionImport.current
      if (!handler) throw new Error("Check your access to saved imports in the current company.")
      const preparation = documentSelectionPreparation(selection)
      const timeout = AbortSignal.timeout(20_000)
      const blob = await readDocumentSelectionFile(selection, signal ? AbortSignal.any([signal, timeout]) : timeout)
      signal?.throwIfAborted()
      if (currentSelectionScope.current !== currentScope || selectionImport.current !== handler)
        throw new Error("The import session changed. Reopen the file and try again.")
      await handler([new File([blob], selection.source.fileName, { type: selection.source.mimeType })], preparation)
      if (currentSelectionScope.current !== currentScope) throw new Error("The company changed while saving the import.")
    } else {
      const text = documentSelectionQuestion(action, selection)
      documentSelectionAnalysisReference(selection)
      setSelectionDraft({ scope: nativeFormScope, action, selection, id: crypto.randomUUID(), text })
    }
    openAiChat()
  }, [nativeFormScope, organizationId, operatingCompanyId, openAiChat])

  return (
    <AssistantNativeFormProvider value={nativeForms}>
    <DocumentSelectionActionsContext.Provider value={onDocumentSelectionAction}>
    <ErpAiChatControllerProvider open={openAiChat}>
      <DashboardWorkspace
        dockRequest={dockRequest}
        onOpenSearch={() => setIsSearchOpen(true)}
        onSignOut={performSignOut}
        userProfile={currentUserProfile.data}
        headerTools={<ModuleActivity />}
        notifications={orgReady && messagesVisible ? <HeaderNotificationBell organizationId={orgId} /> : null}
        sidebar={(collapsed) => (
          <DashboardSidebar
            firstOrgProfile={firstOrgProfile}
            forceCollapsed={collapsed}
            navBadges={navBadges}
            onOpenJournal={journalVisible ? () => setIsJournalOpen(true) : undefined}
            onOpenNotebook={notebookVisible ? openNotebook : undefined}
            onOpenAIChat={openAiChat}
            aiChatOpen={isAIChatOpen}
          />
        )}
        overlays={({ container, docked, canDock }) => (
          <>
            <ErpAiChatPanel
              firstOrgProfile={firstOrgProfile}
              selectionDraft={selectionDraft}
              registerSelectionImport={registerSelectionImport}
              open={isAIChatOpen}
              onClose={() => closeTool("assistant")}
              workspaceHost={container}
              docked={docked === "assistant"}
              onDockToggle={canDock("assistant") ? () => setIsAIChatDocked((prev) => !prev) : undefined}
              onRevealChat={openAiChat}
              onRevealWorkspace={() => {
                setIsAIChatDocked(true)
                if (!canDock("assistant")) closeTool("assistant")
              }}
              config={{
                title: "Lumière Assistant",
                welcomeMessage: "Explore your business, prepare a draft, or turn an insight into a report.",
                placeholder: "Ask about your work or describe what you need...",
              }}
            />

            {notebookVisible && (
              <NotebookPanel
                open={isNotebookOpen}
                onClose={() => closeTool("notebook")}
                onAIChat={openAiChat}
                workspaceHost={container}
                docked={docked === "notebook"}
                onDockToggle={canDock("notebook") ? () => setIsNotebookDocked((prev) => !prev) : undefined}
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
              onOpenNotebook={notebookVisible ? openNotebook : undefined}
              onOpenJournal={journalVisible ? () => setIsJournalOpen(true) : undefined}
            />
          </>
        )}
      >
        {children}
      </DashboardWorkspace>
    </ErpAiChatControllerProvider>
    </DocumentSelectionActionsContext.Provider>
    </AssistantNativeFormProvider>
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
              <ModulePageCompositionProvider>
              <ModulesContent firstOrgProfile={firstOrgProfile}>{children}</ModulesContent>
              </ModulePageCompositionProvider>
            </EntityCurrencyBoundary>
          </ChatterUploaderProvider>
        </ErpAiRouteContextProvider>
      </Suspense>
      </AssistantGuideConversationProvider>
    </WorkspaceProfileProvider>
  )
}
