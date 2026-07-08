"use client"

import { resolveActionDraftRecordHref } from "@lumiere/erp-shared/action-draft-links"
import { toCreateAiActionDraftParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { i18n } from "@lumiere/i18n"
import { aiActionDraftsBffPost } from "@lumiere/stdb/commands"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

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
  organization_id?: number
  companyId?: number
  company_id?: number
  status?: string
  reducerName?: string
  reducer_name?: string
  paramsJson?: string
  params_json?: string
  summary?: string
  confidence?: number
  elevated?: boolean
  warningsJson?: string | null
  warnings_json?: string | null
  sourceQuery?: string | null
  source_query?: string | null
  executionError?: string | null
  execution_error?: string | null
  executionRecordId?: number | string | null
  execution_record_id?: number | string | null
  expiresAt?: number | string | null
  expires_at?: number | string | null
  createDate?: number | string | null
  create_date?: number | string | null
  rejectReason?: string | null
  reject_reason?: string | null
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

export type GatewayActionDraft = {
  reducer_name: string
  params_json: Record<string, unknown>
  confidence: number
  warnings: string[]
  summary: string
  elevated: boolean
}

export type PersistedActionDraft = {
  gateway: GatewayActionDraft
  draftId: number
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
      return parsed as Record<string, unknown>
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
  const reducerName = row.reducerName ?? row.reducer_name ?? ""
  const executionRecordIdRaw = row.executionRecordId ?? row.execution_record_id
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
    paramsJson: parseParamsJson(row.paramsJson ?? row.params_json),
    confidence: Number(row.confidence ?? 0),
    warnings: parseWarnings(row.warningsJson ?? row.warnings_json),
    elevated: Boolean(row.elevated),
    status,
    executionError: row.executionError ?? row.execution_error ?? null,
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
    expiresAt: timestampToIso(row.expiresAt ?? row.expires_at),
    sourceQuery: row.sourceQuery ?? row.source_query ?? null,
    companyId: Number(row.companyId ?? row.company_id ?? 0) || undefined,
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
        const messageType = String(row.messageType ?? row.message_type ?? "").toLowerCase()
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
      const { urlPath, init } = aiActionDraftsBffPost("expire_ai_action_drafts", [])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

export function useCreateAiActionDraft(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      gateway: GatewayActionDraft
      sourceQuery?: string
      uiContextJson?: string | null
    }) => {
      const params = toCreateAiActionDraftParams(args.gateway, {
        sourceQuery: args.sourceQuery,
        uiContextJson: args.uiContextJson,
      })
      if (!params) throw new Error(i18n.t("common.paramsMapper.invalidAiActionDraft"))
      const { urlPath, init } = aiActionDraftsBffPost("create_ai_action_draft", [
        stdbParamsToJson(params, "CreateAiActionDraftParams"),
      ])
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
      const { urlPath, init } = aiActionDraftsBffPost("approve_ai_action_draft", [draftId])
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
      const { urlPath, init } = aiActionDraftsBffPost("reject_ai_action_draft", [
        args.draftId,
        args.reason?.trim() || "Rejected by user",
      ])
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
      const { urlPath, init } = aiActionDraftsBffPost("update_ai_action_draft_params", [
        args.draftId,
        stdbParamsToJson({
          params_json: args.paramsJson,
          summary: args.summary ?? null,
        }, "UpdateAiActionDraftParamsParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      invalidateDraftQueries(qc, organizationId, companyId)
    },
  })
}

/** Fetch latest pending drafts for a company (best-effort after create). */
export async function fetchAiActionDraftRows(): Promise<AiActionDraftRow[]> {
  const r = await apiFetch("/api/query/ai-action-drafts")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: AiActionDraftRow[] }
  return j.data ?? []
}

export function usePersistGatewayActionDrafts(organizationId: number, companyId: number) {
  const createDraft = useCreateAiActionDraft(organizationId, companyId)
  return useMutation({
    mutationFn: async (args: {
      drafts: GatewayActionDraft[]
      sourceQuery?: string
      uiContextJson?: string | null
    }): Promise<PersistedActionDraft[]> => {
      const persisted: PersistedActionDraft[] = []
      for (const gateway of args.drafts) {
        await createDraft.mutateAsync({
          gateway,
          sourceQuery: args.sourceQuery,
          uiContextJson: args.uiContextJson,
        })
        const rows = await fetchAiActionDraftRows()
        const draftId = resolveLatestDraftId(rows, gateway)
        if (draftId == null) {
          throw new Error(`Failed to resolve draft id for ${gateway.reducer_name}`)
        }
        persisted.push({ gateway, draftId })
      }
      return persisted
    },
  })
}

export function resolveLatestDraftId(
  rows: AiActionDraftRow[],
  gateway: GatewayActionDraft,
): number | null {
  const match = rows
    .filter((row) => {
      const reducer = row.reducerName ?? row.reducer_name
      const status = row.status ?? "pending"
      return reducer === gateway.reducer_name && status === "pending"
    })
    .sort((a, b) => Number(b.id) - Number(a.id))[0]
  if (!match?.id) return null
  const id = Number(match.id)
  return Number.isFinite(id) ? id : null
}
