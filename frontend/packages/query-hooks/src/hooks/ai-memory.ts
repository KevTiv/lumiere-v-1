"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { toCreateAiChatSessionParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { i18n } from "@lumiere/i18n"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { AiUiContext } from "../ai-ui-context"
import { apiFetch } from "../http"

export type { AiUiContext } from "../ai-ui-context"

import { httpResponseError, responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

export type AiMemoryContextHit = {
  score: number
  organization_id: number
  company_id: number
  resource_kind: string
  resource_id: string
  resource_version: string
  source_fingerprint: string
  embedding_model: string
  indexed_at: string
  tags: string[]
  activity_timestamp: number
}

export type AiRagSource = {
  kind: "live" | "passage" | "activity" | "web"
  trust: "authoritative" | "persisted" | "retrieved"
  /** Fresh or persisted content still has no instruction or action authority. */
  instruction_trust?: "untrusted"
  entity_type?: string
  entity_id?: string
  source_kind?: string
  source_key?: string
  source_version?: string
  passage_id?: number
  passage_key?: string
  content_hash?: string
  score?: number
  text_snippet: string
  label?: string
  field?: string
  snapshot_at?: string
  url?: string
  fetched_at?: string
}

/** Optional model-selected presentation proposals. Scope and prompts are bound by the host. */
export interface AiRagUiAction {
  capability_key: string
  record_id?: string
}

export interface AiGuideReference {
  guideId: string
  revision: number
}

export type AiChatHistoryReference =
  | { kind: "message"; sessionKey: string; messageId: string }
  | { kind: "decision"; sessionKey: string; messageId: string; decisionId: string; revision: number }
  | { kind: "import_decision"; sessionKey: string; taskId: string; decisionId: string; revision: number }
  | { kind: "import_mapping"; sessionKey: string; taskId: string; batchId: string; itemId: string; revision: number }
  | {
      kind: "approval_receipt"
      taskId: string
      eventId: string
      revision: string
      idempotencyKey: string
      inputHash: string
      actingFor?: string
      workScope: "purchasing" | "sales" | "accounting" | "expenses" | "finance"
    }

 /** Saved import identities only; status and result authority are read by the server. */
export interface AiImportTaskReference {
  taskId: string
  companyId: string
}

/** Authorized saved-document references, distinct from evidence for live ERP facts. */
export interface AiRelatedGuide extends AiGuideReference {
  title: string
  module: string
  workflow?: string
  companyId: string
  language?: string
  reviewState: 'draft' | 'verified' | 'needs_review' | 'superseded'
  updatedAt?: string
  contentHash?: string
  productVersion?: string
}

export type AiChatSessionRow = {
  id: number | string
  organizationId?: number
  organization_id?: number
  companyId?: number
  company_id?: number
  sessionKey?: string
  session_key?: string
  title?: string | null
  route?: string | null
  module?: string | null
  activeTab?: string | null
  active_tab?: string | null
  archived?: boolean
  createDate?: number | string
  create_date?: number | string
  writeDate?: number | string
  write_date?: number | string
  metadata?: string | null
  searchSnippet?: string | null
  searchMessageId?: string | null
}

export type AiChatMessageRow = {
  id: number | string
  organizationId?: number
  organization_id?: number
  companyId?: number
  company_id?: number
  sessionKey?: string
  session_key?: string
  role: "user" | "assistant" | "system" | string
  content: string
  sourcesJson?: string | null
  sources_json?: string | null
  uiContextJson?: string | null
  ui_context_json?: string | null
  model?: string | null
  durationMs?: number | string | null
  duration_ms?: number | string | null
  status?: string
  createDate?: number | string
  create_date?: number | string
  metadata?: string | null
  turnId?: string | null
  historyTruncated?: boolean
}

export type AiChatReadScope = {
  actor: string | null
  organizationId: number
  companyId: number | null
}

type ChatPage<Row> = { data: Row[]; nextCursor?: string | null }

const CHAT_PAGE_SIZE = 30
const MAX_CHAT_PAGES = 3

export function aiChatSessionsQueryKey(organizationId: number) {
  return ["stdb", "ai-chat-sessions", String(organizationId)] as const
}

export function aiChatMessagesQueryKey(organizationId: number, sessionKey?: string) {
  return ["stdb", "ai-chat-messages", String(organizationId), sessionKey ?? "all"] as const
}

function chatScopeKey(scope: AiChatReadScope) {
  return [scope.actor, scope.companyId] as const
}

function canReadChat(scope: AiChatReadScope) {
  return Boolean(scope.actor && scope.organizationId > 0 && scope.companyId != null && scope.companyId > 0)
}

async function readChatPage<Row>(
  resource: "ai-chat-sessions" | "ai-chat-messages",
  companyId: number | null,
  filters: Record<string, string | number | boolean | null | undefined>,
  signal: AbortSignal,
): Promise<ChatPage<Row>> {
  const params = new URLSearchParams({ companyId: String(companyId), limit: String(CHAT_PAGE_SIZE) })
  for (const [name, value] of Object.entries(filters)) {
    if (value != null && value !== "") params.set(name, String(value))
  }
  const response = await apiFetch(`/api/query/${resource}?${params}`, { signal })
  if (!response.ok) throw await httpResponseError(response)
  const result = (await response.json()) as ChatPage<Row>
  return { data: result.data ?? [], nextCursor: result.nextCursor || undefined }
}

export function useAiMemorySearch() {
  return useMutation({
    mutationFn: async (args: { query: string; companyId: number; top_k?: number }) => {
      const r = await apiFetch("/api/ai/context/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          companyId: args.companyId,
          top_k: args.top_k,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { hits: AiMemoryContextHit[] }
    },
  })
}

export type AiActivityReference = {
  resource_kind: "sale_order" | "purchase_order" | "project_task" | "account_move" | "mrp_production" | "product" | "contact"
  /** Decimal string preserves the full native u64 identity. */
  resource_id: string
}

export type AiActivityIngestResult = {
  indexed: number
  unchanged: number
  withheld: number
  automatic_backfill: false
}

/** Index only explicitly selected records in the active company and current actor scope. */
export function useAiMemoryIngest() {
  return useMutation({
    mutationFn: async (args: { companyId: number; resources: AiActivityReference[] }) => {
      const r = await apiFetch("/api/ai/context/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: args.companyId, resources: args.resources }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiActivityIngestResult
    },
  })
}

export function useAiChatSessions(
  scope: AiChatReadScope,
  filters: { archived: boolean; module?: string; search?: string },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [...aiChatSessionsQueryKey(scope.organizationId), ...chatScopeKey(scope), "list", filters],
    queryFn: ({ pageParam, signal }) => readChatPage<AiChatSessionRow>(
      "ai-chat-sessions", scope.companyId, { ...filters, cursor: pageParam }, signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    maxPages: MAX_CHAT_PAGES,
    gcTime: 0,
    enabled: enabled && canReadChat(scope),
    staleTime: 15_000,
  })
}

export function useAiChatSession(scope: AiChatReadScope, sessionKey: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...aiChatSessionsQueryKey(scope.organizationId), ...chatScopeKey(scope), "session", sessionKey],
    queryFn: async ({ signal }) => {
      const page = await readChatPage<AiChatSessionRow>("ai-chat-sessions", scope.companyId, { sessionKey }, signal)
      return page.data[0] ?? null
    },
    gcTime: 0,
    enabled: enabled && canReadChat(scope) && Boolean(sessionKey),
    staleTime: 10_000,
  })
}

export function useAiChatMessages(
  scope: AiChatReadScope,
  sessionKey: string | null,
  enabled: boolean,
) {
  const qc = useQueryClient()
  const queryKey = [...aiChatMessagesQueryKey(scope.organizationId, sessionKey ?? undefined), ...chatScopeKey(scope), "pages"] as const
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => readChatPage<AiChatMessageRow>(
      "ai-chat-messages", scope.companyId, { sessionKey, cursor: pageParam }, signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    maxPages: MAX_CHAT_PAGES,
    gcTime: 0,
    enabled: enabled && canReadChat(scope) && Boolean(sessionKey),
    staleTime: 10_000,
  })
  return {
    ...query,
    hasEvictedLatest: query.data?.pageParams[0] != null,
    resetToLatest: () => qc.resetQueries({ queryKey, exact: true }),
  }
}

export function useAiChatMessage(scope: AiChatReadScope, sessionKey: string | null, messageId: string | undefined) {
  return useQuery({
    queryKey: [...aiChatMessagesQueryKey(scope.organizationId, sessionKey ?? undefined), ...chatScopeKey(scope), "message", messageId],
    queryFn: async ({ signal }) => {
      const page = await readChatPage<AiChatMessageRow>("ai-chat-messages", scope.companyId, { sessionKey, messageId }, signal)
      return page.data[0] ?? null
    },
    gcTime: 0,
    enabled: canReadChat(scope) && Boolean(sessionKey && messageId),
    staleTime: 10_000,
  })
}

export function useUpdateAiChatSession(scope: AiChatReadScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (change: { sessionKey: string } & ({ archived: boolean } | { title: string })) => {
      const { companyId } = scope
      if (companyId == null || companyId <= 0) throw new Error("companyId is required")
      const { urlPath, init } = "archived" in change
        ? stdbBffCommandPost("archive_ai_chat_session", { companyId, sessionKey: change.sessionKey, archived: change.archived })
        : stdbBffCommandPost("update_ai_chat_session_title", {
            companyId,
            sessionKey: change.sessionKey,
            params: stdbParamsToJson({ title: { some: change.title } }, "UpdateAiChatSessionTitleParams"),
          })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw await httpResponseError(response)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [...aiChatSessionsQueryKey(scope.organizationId), ...chatScopeKey(scope)] })
    },
  })
}

export function useCreateAiChatSession(organizationId: number, companyId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      session_key: string
      title?: string | null
      route?: string | null
      module?: string | null
      active_tab?: string | null
      archived?: boolean
      metadata?: string | null
    }) => {
      if (companyId == null || companyId <= 0) {
        throw new Error("companyId is required")
      }
      const mapped = toCreateAiChatSessionParams({
        sessionKey: params.session_key,
        session_key: params.session_key,
        title: params.title,
        route: params.route,
        module: params.module,
        activeTab: params.active_tab,
        active_tab: params.active_tab,
        archived: params.archived,
        metadata: params.metadata,
      })
      if (!mapped) throw new Error(i18n.t("common.paramsMapper.invalidAiChatSession"))
      const { urlPath, init } = stdbBffCommandPost("create_ai_chat_session", {
        companyId,
        params: stdbParamsToJson(mapped, "CreateAiChatSessionParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiChatSessionsQueryKey(organizationId) })
    },
  })
}

export function useAppendAiChatMessage(organizationId: number, companyId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      session_key: string
      role: "user" | "assistant" | "system"
      content: string
      sources_json?: string | null
      ui_context_json?: string | null
      model?: string | null
      duration_ms?: number | null
      status?: string
      metadata?: string | null
    }) => {
      if (companyId == null || companyId <= 0) {
        throw new Error("companyId is required")
      }
      const { urlPath, init } = stdbBffCommandPost("append_ai_chat_message", {
        companyId,
        params: stdbParamsToJson(
          { ...params, status: params.status ?? "completed" },
          "AppendAiChatMessageParams",
        ),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: aiChatSessionsQueryKey(organizationId) })
      void qc.invalidateQueries({
        queryKey: aiChatMessagesQueryKey(organizationId, vars.session_key),
      })
      // An older-page window can evict its newest cursor. Reset to the latest page
      // on writes so the accepted turn is read back and receives a canonical ID.
      void qc.resetQueries({
        queryKey: aiChatMessagesQueryKey(organizationId, vars.session_key),
        predicate: query => {
          const state = query.state.data as { pageParams?: unknown[] } | undefined
          return state?.pageParams?.[0] != null
        },
      })
    },
  })
}

/** RAG over company-scoped embedding collection (validated server-side). */
export type AiSpreadsheetSelectionReference = {
  documentId: string
  versionId: string
  current: boolean
  checksum: string
  sheetName: string
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
  delimiter?: "," | ";" | "\t" | "|"
  encoding?: string
  headerRow?: number
}

export function useAiMemoryRag() {
  return useMutation({
    mutationFn: async (args: {
      query: string
      companyId: number
      agent_id?: number
      include_types?: string[]
      limit?: number
      ui_context?: AiUiContext
      guide_refs?: AiGuideReference[]
      chat_session_key?: string
      history_refs?: AiChatHistoryReference[]
      signal?: AbortSignal
      import_task_refs?: AiImportTaskReference[]
      spreadsheet_selection?: AiSpreadsheetSelectionReference
    }) => {
      const r = await apiFetch("/api/ai/rag", {
        signal: args.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          companyId: args.companyId,
          ...(args.agent_id != null ? { agent_id: args.agent_id } : {}),
          ...(args.include_types?.length ? { include_types: args.include_types } : {}),
          ...(args.limit != null ? { limit: args.limit } : {}),
          ...(args.ui_context ? { ui_context: args.ui_context } : {}),
          ...(args.guide_refs?.length ? { guide_refs: args.guide_refs } : {}),
          ...(args.chat_session_key ? { chat_session_key: args.chat_session_key } : {}),
          ...(args.history_refs?.length ? { history_refs: args.history_refs } : {}),
          ...(args.import_task_refs?.length ? { import_task_refs: args.import_task_refs } : {}),
          ...(args.spreadsheet_selection ? { spreadsheet_selection: args.spreadsheet_selection } : {}),
        }),
      })
      if (!r.ok) throw await httpResponseError(r)
      return (await r.json()) as {
        answer: string
        sources: AiRagSource[]
        ui_actions?: AiRagUiAction[]
        related_guides?: AiRelatedGuide[]
        guide_retrieval_degraded?: boolean
        earlier_context_unavailable?: boolean
        run_id?: number
        agent_id?: number
        provider?: string
        model?: string
      }
    },
  })
}

export function useAiGatewayHealth() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/health", {
        method: "GET",
        cache: "no-store",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as {
        configured: boolean
        upstreamStatus?: number
        upstreamOk?: boolean
        gateway?: unknown
        message?: string
        detail?: string
        reachable?: boolean
      }
    },
  })
}
