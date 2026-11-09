"use client"

import { WorkspaceProfileProvider, useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { ModuleActivity } from "../../components/module-activity"
import { NavigationEditorContext } from "@lumiere/ui/forms/navigation-guard-context"
import { AssistantNativeFormProvider, useAssistantNativeFormController, useAssistantNativeForms } from "@lumiere/ui/components/assistant-native-form-provider"
import { ALPHA_ASSISTANT_CAPABILITIES, ASSISTANT_PAGE_MODULES, assistantActionHref, decodeAssistantAction, getAssistantCapability, isAssistantPageAction, resolveAssistantActionRequest, type AssistantAction, type AssistantActionScope } from "@lumiere/query-hooks/assistant-actions"
import { ModulePageCompositionProvider, useModulePageComposition } from "@/lib/module-page-composition"
import { OperationalPageComposition } from "../../components/operational-page-composition"
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
import { assistantAnswer, assistantAnswerMetadata, coordinateAssistantTurn, readAssistantStream, type TurnFailure } from "@/lib/assistant-turn"
import { i18n } from "@lumiere/i18n"
import { assistantHistoryScope, saveAssistantHistory, scopedAssistantSession } from "@/lib/assistant-history"
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

function ErpAiChatPanel({
  firstOrgProfile,
  selectionDraft,
  registerSelectionImport,
  ...props
}: Omit<ComponentProps<typeof AIChatPanel>, "onSendMessage" | "context"> & {
  firstOrgProfile: boolean
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
  const errorQuestion = useErpAiErrorQuestion()
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
  const messagesQuery = useAiChatMessages(orgId, sessionKey, orgReady && operatingCompanyId != null)
  const companiesQuery = useCompanies(orgId, orgReady)
  const importTasks = useChatImportTasks({ identity, organizationId: orgId, companyId: operatingCompanyId, conversationKey: sessionKey })
  useEffect(() => registerSelectionImport(importTasks.onImportFiles), [importTasks.onImportFiles, registerSelectionImport])
  const [sourcePreview, setSourcePreview] = useState<{ scope: string; documentId: string; versionId: string } | null>(null)
  const scopedSelectionDraft = selectionDraft?.scope === actorHistoryScope ? selectionDraft : null
  const importCompany = companiesQuery.data?.find(company => String(company.id) === String(operatingCompanyId))

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
      actions: [...(parseStoredChatActions(row.metadata) ?? []), ...parseNativeChatActions(row.metadata, actionScope)] as ChatAction[],
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
  }, [messagesQuery.data, sessionKey, actorHistoryScope, orgId, operatingCompanyId, actionScope])

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
          metadata: withGuideReferencesMetadata(withNativeActionsMetadata(
            args.actions?.length || args.runId != null
              ? chatActionsToMetadata(
                  (args.actions ?? []).filter(
                    (action): action is Extract<ChatAction, { type: "draft" }> =>
                      action.type === "draft" && action.draft != null,
                  ),
                  args.runId,
                )
              : null, args.actions),
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
        if (actorHistoryScope) setOpenGuide({ scope: actorHistoryScope, request })
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
      onNativeAction: (proposed: AssistantAction) => {
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
              const result = composer.requestPage({ requestId: crypto.randomUUID(), scopeKey, moduleId: capability.module, pageId: action.pageId, kind: action.kind, widgetKey: action.widgetKey, prompt: action.prompt })
              if (result !== "pending") throw new Error(i18n.t(result === "busy" ? "aiChat.native.pageBusy" : "aiChat.native.scopeChanged"))
              // Preserve the current date range and filters when opening this page's editor.
              if (composer.page?.moduleId !== capability.module || (action.pageId && composer.page.pageId !== action.pageId)) router.push(href)
            } else if (action.kind === "open_form") {
              if (!nativeForms || !capability.tab) throw new Error(i18n.t("aiChat.native.formUnavailable"))
              const result = nativeForms.requestForm({ requestId: crypto.randomUUID(), scopeKey, moduleId: capability.module, tabId: capability.tab, prompt: action.prompt })
              if (result !== "pending") throw new Error(i18n.t(result === "busy" ? "aiChat.native.formBusy" : "aiChat.native.scopeChanged"))
            }
            if (!isAssistantPageAction(action)) router.push(href)
            if (!props.docked) props.onDockToggle?.()
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
      props.docked,
      props.onDockToggle,
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
        const answer = await rag.mutateAsync({
          query: selectedDocument.action === "explain"
            ? "Explain the selected spreadsheet cells."
            : "Check the selected spreadsheet cells for issues.",
          companyId: operatingCompanyId,
          spreadsheet_selection: documentSelectionAnalysisReference(selectedDocument.selection),
          ...(requestedAgentId ? { agent_id: requestedAgentId } : {}),
        })
        if (!isCurrent()) return { content: "", sources: [] as ChatMessageSourceRef[] }
        return { content: answer.answer, sources: answer.sources.map(mapRagSourceToChatSource), runId: answer.run_id }
      }
      const { includeTypes, uiContext } = buildRequestContext(userText, questionGuide)
      const turnPage = !questionGuide && workspaceScope.usesCurrentPage && pageComposition?.page?.moduleId === module ? pageComposition.page : undefined
      const focusedImport = importTasks.focusedTask
      const importTaskRefs = focusedImport?.companyId === String(operatingCompanyId)
        ? [{ taskId: focusedImport.requestId, companyId: focusedImport.companyId }]
        : undefined
      let presentationResolution = !questionGuide && !isAssistantErrorQuestion(userText) && actionScope
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
        void persistExchange({ userText, assistantText: presentation.content, sources: presentation.sources, uiContext, actions: presentation.actions })
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
            include_types: includeTypes, ui_context: uiContext, guide_refs: guideRefs, import_task_refs: importTaskRefs,
            ...(requestedAgentId ? { agent_id: requestedAgentId } : {}),
          }))
          const response = await fetch("/api/ai/rag/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: questionGuide ? guideDraftQuestion(questionGuide, userText, hasUnsavedGuideEdits) : userText, companyId: operatingCompanyId,
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
        drafts: !questionGuide && !isAssistantErrorQuestion(userText) && looksLikeActionDraftRequest(userText) ? () => resolveActionDrafts(userText, uiContext) : undefined,
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
      const failureText = (phase: "answer" | "draft", failure: TurnFailure) => i18n.t(`aiChat.turn.${phase}.${failure}`)
      const parts = [turn.answer.kind === "ready" ? turn.answer.value.answer : failureText("answer", turn.answer.kind)]
      if (turn.drafts.kind === "ready") {
        parts.push(draftActions.length ? i18n.t("aiChat.turn.reviewDrafts") : i18n.t("aiChat.turn.noDraft"))
      } else if (turn.drafts.kind !== "not_requested") parts.push(failureText("draft", turn.drafts.kind))
      const content = parts.join("\n\n")
      void persistExchange({
        userText, assistantText: content, sources, uiContext, guides,
        durationMs: Math.round(performance.now() - started), model: out?.model ?? null,
        actions: actions.length ? actions : undefined, runId: out?.run_id,
      })
      return { content, runId: out?.run_id, sources, guides, importTasks: taskStatuses, actions: actions.length ? actions : undefined }
    },
    [orgId, orgReady, operatingCompanyId, selectedAgent, requestedAgentId, companiesQuery.isLoading, historyScope, buildRequestContext, rag, resolveActionDrafts, persistExchange, actionScope, workspaceScope, module, allowedActionModules, permissionsReady, checkPermission, pageComposition?.page, importTasks.focusedTask, scopedSelectionDraft],
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
      composerRequest={errorQuestion ?? scopedSelectionDraft}
      modal={Boolean(errorQuestion)}
      historySaveFailed={failedHistoryScope === historyScope}
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
    {sourcePreview?.scope === actorHistoryScope && organizationId ? (
      <DocumentViewerDialog organizationId={BigInt(organizationId)} documentId={sourcePreview.documentId}
        versionId={sourcePreview.versionId} onOpenChange={open => { if (!open) setSourcePreview(null) }} />
    ) : null}
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
  const [isAIChatDocked, setIsAIChatDocked] = useState(true)
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [isJournalOpen, setIsJournalOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const workspaceProfile = useWorkspaceProfile()
  const messagesVisible = isWorkspaceSurfaceVisible(workspaceProfile, "messages")
  const journalVisible = isWorkspaceSurfaceVisible(workspaceProfile, "journal")
  const notebookVisible = isWorkspaceSurfaceVisible(workspaceProfile, "notebook")
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
    setIsAIChatOpen(true)
  }, [])

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
        forceCollapsed={(isAIChatOpen && isAIChatDocked) || isNotebookOpen}
        onOpenSearch={() => setIsSearchOpen(true)}
        onSignOut={performSignOut}
        userProfile={currentUserProfile.data}
        notifications={orgReady && messagesVisible ? <HeaderNotificationBell organizationId={orgId} /> : null}
        sidebar={
          <DashboardSidebar
            firstOrgProfile={firstOrgProfile}
            forceCollapsed={(isAIChatOpen && isAIChatDocked) || isNotebookOpen}
            navBadges={navBadges}
            onOpenJournal={journalVisible ? () => setIsJournalOpen(true) : undefined}
            onOpenNotebook={notebookVisible ? () => setIsNotebookOpen(true) : undefined}
            onOpenAIChat={openAiChat}
            aiChatOpen={isAIChatOpen}
          />
        }
        overlays={
          <>
            <ErpAiChatPanel
              firstOrgProfile={firstOrgProfile}
              selectionDraft={selectionDraft}
              registerSelectionImport={registerSelectionImport}
              open={isAIChatOpen}
              onClose={() => {
                setIsAIChatOpen(false)
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
        <ModuleActivity />
        <OperationalPageComposition />
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
