"use client"

import { approvalsBffPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { WorkflowHumanTaskDecision } from "@lumiere/stdb/types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

function newIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type HumanTaskRow = {
  id: number | string
  organizationId?: number
  organization_id?: number
  companyId?: number
  company_id?: number
  workflowId?: number
  workflow_id?: number
  workflowVersionId?: number
  workflow_version_id?: number
  workflowInstanceId?: number
  workflow_instance_id?: number
  instanceRevision?: number
  instance_revision?: number
  nodeKey?: string
  node_key?: string
  kind?: string | { tag?: string }
  assignment?: string | { tag?: string }
  subjectModel?: string
  subject_model?: string
  subjectId?: number
  subject_id?: number
  subjectRevisionHash?: string
  subject_revision_hash?: string
  status?: string | { tag?: string }
  revision?: number
  requireCommentOnReject?: boolean
  require_comment_on_reject?: boolean
  requestedBy?: unknown
  requested_by?: unknown
  claimedBy?: unknown
  claimed_by?: unknown
  decision?: string | { tag?: string } | null
  decisionComment?: string | null
  decision_comment?: string | null
  correlationId?: string
  correlation_id?: string
  summary?: {
    subjectModel?: unknown
    subjectId?: unknown
    nodeKey?: unknown
  }
  guardedAction?: { key?: unknown; schemaVersion?: number } | null
  guarded_action?: { key?: unknown; schemaVersion?: number } | null
  // Legacy aliases used by older panels
  model?: string
  resId?: number
  res_id?: number
  action?: string
  contextJson?: string | null
  context_json?: string | null
}

function taskStatusTag(row: HumanTaskRow): string {
  const s = row.status
  if (typeof s === "string") return s
  if (s && typeof s === "object" && "tag" in s && typeof s.tag === "string") return s.tag
  if (s && typeof s === "object") {
    const keys = Object.keys(s)
    if (keys.length === 1) return keys[0]!
  }
  return ""
}

export function humanTaskInboxQueryKey(organizationId: number, companyId?: number | null) {
  return ["workflow-human-tasks-inbox", String(organizationId), String(companyId ?? "")] as const
}

export async function fetchHumanTaskInboxRows(): Promise<HumanTaskRow[]> {
  const r = await apiFetch("/api/query/workflow-human-tasks-inbox")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: HumanTaskRow[] }
  return j.data ?? []
}

export function useHumanTaskInbox(
  organizationId: number,
  companyId?: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: humanTaskInboxQueryKey(organizationId, companyId),
    queryFn: async () => {
      const rows = await fetchHumanTaskInboxRows()
      if (companyId == null || companyId <= 0) return rows
      return rows.filter((row) => {
        const cid = Number(row.companyId ?? row.company_id ?? 0)
        return cid === companyId
      })
    },
    enabled: enabled && organizationId > 0,
    refetchInterval: 30_000,
  })
}

/** @deprecated Prefer useHumanTaskInbox — kept for shell badge compatibility. */
export function useApprovalInbox(organizationId: number, enabled = true) {
  return useHumanTaskInbox(organizationId, null, enabled)
}

export function useApprovalInboxCount(organizationId: number, enabled = true) {
  const query = useHumanTaskInbox(organizationId, null, enabled)
  const open = (query.data ?? []).filter((row) => {
    const status = taskStatusTag(row)
    return status === "Open" || status === "Claimed"
  })
  return {
    ...query,
    count: open.length,
  }
}

function invalidateHumanTaskQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  void qc.invalidateQueries({ queryKey: ["workflow-human-tasks-inbox"] })
  void qc.invalidateQueries({ queryKey: ["workflow-human-tasks"] })
  void qc.invalidateQueries({ queryKey: ["workflow-human-task-events"] })
  void qc.invalidateQueries({ queryKey: ["workflow-instances"] })
  void qc.invalidateQueries({ queryKey: ["purchase-orders"] })
  void qc.invalidateQueries({ queryKey: ["sale-orders"] })
  void qc.invalidateQueries({ queryKey: ["account-moves"] })
  void qc.invalidateQueries({ queryKey: ["account-payments"] })
  void qc.invalidateQueries({ queryKey: ["ai-action-drafts"] })
  void qc.invalidateQueries({ queryKey: ["mail-messages"] })
  void qc.invalidateQueries({ queryKey: approvalInboxQueryKey(organizationId) })
}

/** Legacy alias used by older call sites. */
export function approvalInboxQueryKey(organizationId: number) {
  return humanTaskInboxQueryKey(organizationId, null)
}

export type ClaimHumanTaskInput = {
  companyId: number
  taskId: number
  expectedRevision: number
  actingFor?: unknown
  correlationId?: string
}

export function useClaimHumanTask(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ClaimHumanTaskInput) => {
      const params = {
        companyId: input.companyId,
        taskId: input.taskId,
        expectedRevision: input.expectedRevision,
        actingFor: input.actingFor ?? null,
        idempotencyKey: newIdempotencyKey("claim"),
        correlationId: input.correlationId ?? newIdempotencyKey("corr"),
      }
      const { urlPath, init } = approvalsBffPost("claim_workflow_human_task", [
        organizationId,
        stdbParamsToJson(params, "ClaimWorkflowHumanTaskParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateHumanTaskQueries(qc, organizationId),
  })
}

export type DecideHumanTaskInput = {
  companyId: number
  taskId: number
  expectedTaskRevision: number
  expectedInstanceRevision: number
  decision: WorkflowHumanTaskDecision | { tag: "Approve" | "Reject" | "Complete" }
  actingFor?: unknown
  comment?: string | null
  correlationId?: string
}

export function useDecideHumanTask(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: DecideHumanTaskInput) => {
      const decision =
        typeof input.decision === "object" && input.decision && "tag" in input.decision
          ? input.decision
          : { tag: String(input.decision) }
      const params = {
        companyId: input.companyId,
        taskId: input.taskId,
        expectedTaskRevision: input.expectedTaskRevision,
        expectedInstanceRevision: input.expectedInstanceRevision,
        decision,
        actingFor: input.actingFor ?? null,
        comment: input.comment ?? null,
        idempotencyKey: newIdempotencyKey("decide"),
        correlationId: input.correlationId ?? newIdempotencyKey("corr"),
        causationId: null,
      }
      const { urlPath, init } = approvalsBffPost("decide_workflow_human_task", [
        organizationId,
        stdbParamsToJson(params, "DecideWorkflowHumanTaskParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateHumanTaskQueries(qc, organizationId),
  })
}

/** Compatibility wrappers for sales/purchasing panels during cutover. */
export function useApproveApprovalRequest(organizationId: number, _companyId: number) {
  const decide = useDecideHumanTask(organizationId)
  const claim = useClaimHumanTask(organizationId)
  const inbox = useHumanTaskInbox(organizationId, null, organizationId > 0)
  return useMutation({
    mutationFn: async (taskId: number) => {
      const row = (inbox.data ?? []).find((r) => Number(r.id) === taskId)
      if (!row) throw new Error("Human task not found in inbox")
      const companyId = humanTaskCompanyId(row)
      const status = taskStatusTag(row)
      if (status === "Open") {
        await claim.mutateAsync({
          companyId,
          taskId,
          expectedRevision: humanTaskRevision(row),
        })
        // Refresh expected revision after claim — claim bumps revision by 1.
        await decide.mutateAsync({
          companyId,
          taskId,
          expectedTaskRevision: humanTaskRevision(row) + 1,
          expectedInstanceRevision: Number(
            row.instanceRevision ?? row.instance_revision ?? 0,
          ),
          decision: { tag: "Approve" },
        })
        return
      }
      await decide.mutateAsync({
        companyId,
        taskId,
        expectedTaskRevision: humanTaskRevision(row),
        expectedInstanceRevision: Number(
          row.instanceRevision ?? row.instance_revision ?? 0,
        ),
        decision: { tag: "Approve" },
      })
    },
  })
}

export function useRejectApprovalRequest(organizationId: number, _companyId: number) {
  const decide = useDecideHumanTask(organizationId)
  const claim = useClaimHumanTask(organizationId)
  const inbox = useHumanTaskInbox(organizationId, null, organizationId > 0)
  return useMutation({
    mutationFn: async (input: { requestId: number; reason: string; comment?: string }) => {
      const row = (inbox.data ?? []).find((r) => Number(r.id) === input.requestId)
      if (!row) throw new Error("Human task not found in inbox")
      const companyId = humanTaskCompanyId(row)
      const status = taskStatusTag(row)
      const comment = input.comment?.trim() || input.reason
      let expectedTaskRevision = humanTaskRevision(row)
      if (status === "Open") {
        await claim.mutateAsync({
          companyId,
          taskId: input.requestId,
          expectedRevision: expectedTaskRevision,
        })
        expectedTaskRevision += 1
      }
      await decide.mutateAsync({
        companyId,
        taskId: input.requestId,
        expectedTaskRevision,
        expectedInstanceRevision: Number(
          row.instanceRevision ?? row.instance_revision ?? 0,
        ),
        decision: { tag: "Reject" },
        comment,
      })
    },
  })
}

export function useCreateApprovalRule(_organizationId: number, _companyId?: number) {
  return useMutation({
    mutationFn: async () => {
      throw new Error(
        "Approval rules were replaced by published workflow versions; use the Workflows module",
      )
    },
  })
}

export function useApprovalRules(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: ["approval-rules", String(organizationId)],
    queryFn: async () => [] as [],
    enabled: enabled && organizationId > 0,
  })
}

export type ApprovalRequestRow = HumanTaskRow
export type ApprovalRuleRow = Record<string, never>

export function approvalRecordHref(model?: string, resId?: number): string | undefined {
  if (!model || resId == null || resId <= 0) return undefined
  switch (model) {
    case "purchase_order":
      return `/purchasing?po=${resId}`
    case "sale_order":
      return `/sales?so=${resId}`
    case "account_move":
      return `/accounting?invoice=${resId}`
    case "account_payment":
      return `/accounting?payment=${resId}`
    case "ai_action_draft":
      return `/ai-action-drafts?draft=${resId}`
    case "hr_expense_sheet":
      return `/expenses?sheet=${resId}`
    default:
      return undefined
  }
}

export function isAiDraftApprovalRequest(row: HumanTaskRow): boolean {
  const model = humanTaskSubjectModel(row) ?? row.model
  return model === "ai_action_draft"
}

export function useApprovalRequests(organizationId: number, enabled = true) {
  return useHumanTaskInbox(organizationId, null, enabled)
}

export async function fetchApprovalInboxRows(): Promise<HumanTaskRow[]> {
  return fetchHumanTaskInboxRows()
}

export async function fetchApprovalRequestRows(): Promise<HumanTaskRow[]> {
  const r = await apiFetch("/api/query/workflow-human-tasks")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: HumanTaskRow[] }
  return j.data ?? []
}

export function useExpenseSheetApprovalTimeline(
  organizationId: number,
  sheetId: number | string | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: ["workflow-human-tasks", String(organizationId), "expense", String(sheetId ?? "")],
    queryFn: fetchApprovalRequestRows,
    enabled: enabled && organizationId > 0 && sheetId != null,
    staleTime: 30_000,
  })
  const resId = sheetId != null ? Number(sheetId) : NaN
  const rows = (query.data ?? []).filter((row) => {
    const model = humanTaskSubjectModel(row) ?? row.model ?? ""
    const id = humanTaskSubjectId(row) ?? Number(row.resId ?? row.res_id ?? 0)
    return model === "hr_expense_sheet" && id === resId
  })
  return { ...query, rows }
}

export function humanTaskSubjectModel(row: HumanTaskRow): string | undefined {
  const fromSummary =
    typeof row.summary?.subjectModel === "string" ? row.summary.subjectModel : undefined
  return row.subjectModel ?? row.subject_model ?? fromSummary ?? row.model
}

export function humanTaskSubjectId(row: HumanTaskRow): number | undefined {
  const fromSummary =
    typeof row.summary?.subjectId === "number"
      ? row.summary.subjectId
      : typeof row.summary?.subjectId === "string"
        ? Number(row.summary.subjectId)
        : undefined
  const id = row.subjectId ?? row.subject_id ?? fromSummary ?? row.resId ?? row.res_id
  if (id == null) return undefined
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function humanTaskId(row: HumanTaskRow): number {
  return Number(row.id)
}

export function humanTaskRevision(row: HumanTaskRow): number {
  return Number(row.revision ?? 0)
}

export function humanTaskCompanyId(row: HumanTaskRow): number {
  return Number(row.companyId ?? row.company_id ?? 0)
}

export { taskStatusTag }
