"use client"

import { aiChatBffPost } from "@lumiere/stdb/commands"
import { toCreateAiChatSessionParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { i18n } from "@lumiere/i18n"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { AiUiContext } from "../ai-ui-context"
import { apiFetch } from "../http"

export type { AiUiContext } from "../ai-ui-context"

import { responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

export type AiMemoryContextHit = {
  score: number
  entity_type: string
  entity_id: string
  text: string
  timestamp: number
  source: string
}

export type AiRagSource = {
  kind?: string
  trust?: string
  content_type?: string
  content_id?: number
  entity_type?: string
  entity_id?: string
  score?: number
  text_snippet: string
  label?: string
  field?: string
  snapshot_at?: string
  url?: string
  fetched_at?: string
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
    mutationFn: async (args: { query: string; top_k?: number }) => {
      const r = await apiFetch("/api/ai/context/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          top_k: args.top_k,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { hits: AiMemoryContextHit[] }
    },
  })
}

export function useAiMemoryIngest() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/context/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { ingested: number }
    },
  })
}

export function useAiMemoryDocumentIngest() {
  return useMutation({
    mutationFn: async (args: {
      doc_id: string
      content: string
      doc_type?: string
      filename?: string
      mime_type?: string
    }) => {
      const r = await apiFetch("/api/ai/context/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as {
        ok: boolean
        doc_id: string
        chunks_embedded: number
        extracted_text: string
        structured_fields: unknown
        stdb_job_id: number
      }
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
      const { urlPath, init } = aiChatBffPost("create_ai_chat_session", [
        organizationId,
        companyId,
        stdbParamsToJson(mapped as object),
      ])
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
      const { urlPath, init } = aiChatBffPost("append_ai_chat_message", [
        organizationId,
        companyId,
        stdbParamsToJson({
          ...params,
          sources_json: params.sources_json ?? null,
          ui_context_json: params.ui_context_json ?? null,
          model: params.model ?? null,
          duration_ms: params.duration_ms ?? null,
          status: params.status ?? "completed",
          metadata: params.metadata ?? null,
        }),
      ])
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
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as {
        answer: string
        sources: AiRagSource[]
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
