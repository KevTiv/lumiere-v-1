"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { JsonObject } from "@lumiere/api-client/json-object"
import { resolveActionDraftRecordHref } from "@lumiere/erp-shared/action-draft-links"
import { toCamelCase } from "@lumiere/erp-shared/row-values"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function draftsQueryKey(organizationId: number, companyId?: number) {
  return ["ai-action-drafts", String(organizationId), companyId != null ? String(companyId) : "all"] as const
}

export function aiActionDraftInboxQueryKey(organizationId: number) {
  return ["ai-action-drafts-inbox", String(organizationId)] as const
}

function invalidateDraftQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
  companyId: number,
) {
  void qc.invalidateQueries({ queryKey: draftsQueryKey(organizationId, companyId) })
  void qc.invalidateQueries({ queryKey: aiActionDraftInboxQueryKey(organizationId) })
  void qc.invalidateQueries({ queryKey: ["mail-messages"] })
}

export type AiActionDraftRow = {
  id: number | string
  organizationId?: number
  companyId?: number
  status?: string
  reducerName?: string
  paramsJson?: string
  summary?: string
  confidence?: number
  elevated?: boolean
  warningsJson?: string | null
  sourceQuery?: string | null
  executionError?: string | null
  executionRecordId?: number | string | null
  expiresAt?: number | string | null
  createDate?: number | string | null
  rejectReason?: string | null
  metadata?: string | null
}

export type AiActionDraftPayload = {
  draftId: number
  reducerName: string
  summary: string
  paramsJson: Record<string, unknown>
  confidence: number
  warnings: string[]
  elevated: boolean
  status?: "pending" | "approved" | "rejected" | "failed" | "expired"
  executionError?: string | null
  executionRecordId?: number | null
  executionRecordHref?: string
  expiresAt?: string | null
  sourceQuery?: string | null
  companyId?: number
  workflowInstanceId?: number
}

/** Raw JSON returned by the AI gateway HTTP endpoint. */
export type GatewayActionDraftWireDto = {
  draft_id: number
  reducer_name: string
  params_json: Record<string, unknown>
  confidence: number
  warnings: string[]
  summary: string
  elevated: boolean
}

/** Camel-case application DTO used after the HTTP boundary. */
export type GatewayActionDraft = {
  draftId: number
  reducerName: string
  paramsJson: JsonObject
  confidence: number
  warnings: string[]
  summary: string
  elevated: boolean
}

export type PersistedActionDraft = {
  gateway: GatewayActionDraft
  draftId: number
}

export function normalizeGatewayActionDraft(
  wire: GatewayActionDraftWireDto,
): GatewayActionDraft {
  return {
    draftId: Number(wire.draft_id),
    reducerName: wire.reducer_name,
    paramsJson: normalizeWireParams(wire.params_json),
    confidence: wire.confidence,
    warnings: wire.warnings,
    summary: wire.summary,
    elevated: wire.elevated,
  }
}

function normalizeWireJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeWireJson)
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [toCamelCase(key), normalizeWireJson(nested)]),
  )
}

function normalizeWireParams(value: JsonObject): JsonObject {
  return normalizeWireJson(value) as JsonObject
}

export function normalizeGatewayActionDraftResponse(
  wire: { drafts?: GatewayActionDraftWireDto[] },
): { drafts: GatewayActionDraft[] } {
  return { drafts: (wire.drafts ?? []).map(normalizeGatewayActionDraft) }
}

function parseWarnings(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function parseParamsJson(raw?: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeWireParams(parsed as Record<string, unknown>)
    }
  } catch {
    /* ignore */
  }
  return {}
}

function timestampToIso(raw?: number | string | null): string | null {
  if (raw == null || raw === "") return null
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return null
  const ms = numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseDraftMetadata(raw?: string | null): { workflowInstanceId?: number } {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as { workflow_instance_id?: number | string }
    const workflowInstanceId = Number(parsed.workflow_instance_id)
    if (!Number.isFinite(workflowInstanceId) || workflowInstanceId <= 0) return {}
    return { workflowInstanceId }
  } catch {
    return {}
  }
}

export function aiActionDraftRowToPayload(row: AiActionDraftRow): AiActionDraftPayload {
  const draftId = Number(row.id)
  const reducerName = row.reducerName ?? ""
  const executionRecordIdRaw = row.executionRecordId
  const executionRecordId =
    executionRecordIdRaw != null && executionRecordIdRaw !== ""
      ? Number(executionRecordIdRaw)
      : null
  const status = (row.status ?? "pending") as AiActionDraftPayload["status"]
  const { workflowInstanceId } = parseDraftMetadata(row.metadata ?? null)

  return {
    draftId,
    reducerName,
    summary: row.summary ?? "",
    paramsJson: parseParamsJson(row.paramsJson),
    confidence: Number(row.confidence ?? 0),
    warnings: parseWarnings(row.warningsJson),
    elevated: Boolean(row.elevated),
    status,
    executionError: row.executionError ?? null,
    executionRecordId:
      executionRecordId != null && Number.isFinite(executionRecordId)
        ? executionRecordId
        : null,
    executionRecordHref: resolveActionDraftRecordHref(
      reducerName,
      executionRecordId != null && Number.isFinite(executionRecordId)
        ? executionRecordId
        : null,
    ),
    expiresAt: timestampToIso(row.expiresAt),
    sourceQuery: row.sourceQuery ?? null,
    companyId: Number(row.companyId ?? 0) || undefined,
    workflowInstanceId,
  }
}

export async function fetchAiActionDraftInboxRows(): Promise<AiActionDraftRow[]> {
  const r = await apiFetch("/api/query/ai-action-drafts-inbox")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: AiActionDraftRow[] }
  return j.data ?? []
}

export function useAiActionDraftInbox(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: aiActionDraftInboxQueryKey(organizationId),
    queryFn: fetchAiActionDraftInboxRows,
    enabled: enabled && organizationId > 0,
    refetchInterval: 30_000,
  })
}

export function useAiActionDraftInboxCount(organizationId: number, enabled = true) {
  const query = useAiActionDraftInbox(organizationId, enabled)
  return {
    ...query,
    count: query.data?.length ?? 0,
  }
}

export function useAiActionDraftNotifications(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: ["ai-action-draft-notifications", String(organizationId)],
    queryFn: async () => {
      const r = await apiFetch("/api/query/mail-messages")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: Array<Record<string, unknown>> }
      return (j.data ?? []).filter((row) => {
        const model = String(row.model ?? "").toLowerCase()
        const messageType = String(row.messageType ?? "").toLowerCase()
        const subtype = String(row.subtype ?? "")
        return (
          model === "ai_action_draft" &&
          (messageType === "notification" || subtype.startsWith("ai.action_draft."))
        )
      })
    },
    enabled: enabled && organizationId > 0,
    refetchInterval: 30_000,
  })
}

export function useExpireAiActionDrafts(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = stdbBffCommandPost("expire_ai_action_drafts", { companyId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

export function useApproveAiActionDraft(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: number | { draftId: number; companyId?: number }) => {
      const draftId = typeof args === "number" ? args : args.draftId
      const { urlPath, init } = stdbBffCommandPost("approve_ai_action_draft", {
        companyId,
        draftId,
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
      void qc.invalidateQueries({ queryKey: ["tasks", String(organizationId)] })
    },
  })
}

export function useRejectAiActionDraft(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      draftId: number
      reason?: string
      companyId?: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("reject_ai_action_draft", {
        companyId,
        draftId: args.draftId,
        reason: args.reason?.trim() || "Rejected by user",
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

export function useUpdateAiActionDraftParams(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      draftId: number
      paramsJson: string
      summary?: string
      companyId?: number
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_ai_action_draft_params", {
        companyId,
        draftId: args.draftId,
        params: stdbParamsToJson(
          {
            paramsJson: args.paramsJson,
            summary: args.summary ?? null,
          },
          "UpdateAiActionDraftParamsParams",
        ),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

export function usePersistGatewayActionDrafts(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      drafts: GatewayActionDraft[]
      sourceQuery?: string
      uiContextJson?: string | null
    }): Promise<PersistedActionDraft[]> => resolvePersistedActionDrafts(args.drafts),
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

/**
 * Accept only server-persisted drafts with an exact request/effect result.
 * Duplicate ids are an invariant failure; choosing one would hide an
 * ambiguous server response under concurrency or replay.
 */
export function resolvePersistedActionDrafts(
  drafts: GatewayActionDraft[],
): PersistedActionDraft[] {
  const seenDraftIds = new Set<number>()
  return drafts.map((gateway) => {
    const draftId = Number(gateway.draftId)
    if (!Number.isSafeInteger(draftId) || draftId <= 0) {
      throw new Error(`Missing stable draft id for ${gateway.reducerName}`)
    }
    if (seenDraftIds.has(draftId)) {
      throw new Error(`Ambiguous stable draft id ${draftId}`)
    }
    seenDraftIds.add(draftId)
    return { gateway, draftId }
  })
}
