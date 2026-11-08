"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { toCreateAiChatSessionParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { i18n } from "@lumiere/i18n"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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
}

export function aiChatSessionsQueryKey(organizationId: number) {
  return ["stdb", "ai-chat-sessions", String(organizationId)] as const
}

export function aiChatMessagesQueryKey(organizationId: number, sessionKey?: string) {
  return ["stdb", "ai-chat-messages", String(organizationId), sessionKey ?? "all"] as const
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

export function useAiChatSessions(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: aiChatSessionsQueryKey(organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/ai-chat-sessions")
      if (!r.ok) throw new Error(await parseAiError(r))
      const j = (await r.json()) as { data?: AiChatSessionRow[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

export function useAiChatMessages(
  organizationId: number,
  sessionKey: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: aiChatMessagesQueryKey(organizationId, sessionKey ?? undefined),
    queryFn: async () => {
      const r = await apiFetch("/api/query/ai-chat-messages")
      if (!r.ok) throw new Error(await parseAiError(r))
      const j = (await r.json()) as { data?: AiChatMessageRow[] }
      const rows = j.data ?? []
      return sessionKey
        ? rows.filter((row) => (row.sessionKey ?? row.session_key) === sessionKey)
        : rows
    },
    enabled: enabled && organizationId > 0 && !!sessionKey,
    staleTime: 10_000,
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
    },
  })
}

/** RAG over company-scoped embedding collection (validated server-side). */
export function useAiMemoryRag() {
  return useMutation({
    mutationFn: async (args: {
      query: string
      companyId: number
      include_types?: string[]
      limit?: number
      ui_context?: AiUiContext
      guide_refs?: AiGuideReference[]
      import_task_refs?: AiImportTaskReference[]
    }) => {
      const r = await apiFetch("/api/ai/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          companyId: args.companyId,
          ...(args.include_types?.length ? { include_types: args.include_types } : {}),
          ...(args.limit != null ? { limit: args.limit } : {}),
          ...(args.ui_context ? { ui_context: args.ui_context } : {}),
          ...(args.guide_refs?.length ? { guide_refs: args.guide_refs } : {}),
          ...(args.import_task_refs?.length ? { import_task_refs: args.import_task_refs } : {}),
        }),
      })
      if (!r.ok) throw await httpResponseError(r)
      return (await r.json()) as {
        answer: string
        sources: AiRagSource[]
        ui_actions?: AiRagUiAction[]
        related_guides?: AiRelatedGuide[]
        guide_retrieval_degraded?: boolean
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
