"use client"

import { approvalsBffPost } from "@lumiere/stdb/commands"
import { toCreateApprovalRuleParams } from "@lumiere/erp-shared/approvals-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "../http"

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export type ApprovalRequestRow = {
  id: number | string
  organizationId?: number
  organization_id?: number
  companyId?: number
  company_id?: number
  ruleId?: number
  rule_id?: number
  model?: string
  resId?: number
  res_id?: number
  action?: string
  paramsJson?: string
  params_json?: string
  status?: string
  summary?: string
  contextJson?: string | null
  context_json?: string | null
  requestedBy?: string
  requested_by?: string
  requestedAt?: number | string
  requested_at?: number | string
  rejectReason?: string | null
  reject_reason?: string | null
  metadata?: string | null
}

export type ApprovalRuleRow = {
  id: number | string
  organizationId?: number
  organization_id?: number
  companyId?: number | null
  company_id?: number | null
  name?: string
  model?: string
  action?: string
  ruleType?: string
  rule_type?: string
  threshold?: number
  isActive?: boolean
  is_active?: boolean
  sequence?: number
}

export function approvalInboxQueryKey(organizationId: number) {
  return ["approval-requests-inbox", String(organizationId)] as const
}

export async function fetchApprovalInboxRows(): Promise<ApprovalRequestRow[]> {
  const r = await apiFetch("/api/query/approval-requests-inbox")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: ApprovalRequestRow[] }
  return j.data ?? []
}

export function useApprovalInbox(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: approvalInboxQueryKey(organizationId),
    queryFn: fetchApprovalInboxRows,
    enabled: enabled && organizationId > 0,
    refetchInterval: 30_000,
  })
}

export function useApprovalInboxCount(organizationId: number, enabled = true) {
  const query = useApprovalInbox(organizationId, enabled)
  return {
    ...query,
    count: query.data?.length ?? 0,
  }
}

function invalidateApprovalQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: number,
) {
  void qc.invalidateQueries({ queryKey: approvalInboxQueryKey(organizationId) })
  void qc.invalidateQueries({ queryKey: ["approval-requests"] })
  void qc.invalidateQueries({ queryKey: ["purchase-orders"] })
  void qc.invalidateQueries({ queryKey: ["sale-orders"] })
  void qc.invalidateQueries({ queryKey: ["account-moves"] })
  void qc.invalidateQueries({ queryKey: ["account-payments"] })
  void qc.invalidateQueries({ queryKey: ["ai-action-drafts"] })
  void qc.invalidateQueries({ queryKey: ["mail-messages"] })
}

export function useApproveApprovalRequest(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (requestId: number) => {
      const { urlPath, init } = approvalsBffPost("approve_approval_request", [
        organizationId,
        companyId,
        requestId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateApprovalQueries(qc, organizationId),
  })
}

export function useRejectApprovalRequest(organizationId: number, companyId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { requestId: number; reason: string; comment?: string }) => {
      const { urlPath, init } = approvalsBffPost("reject_approval_request", [
        organizationId,
        companyId,
        input.requestId,
        { reason: input.reason, comment: input.comment ?? null },
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateApprovalQueries(qc, organizationId),
  })
}

export async function fetchApprovalRulesRows(): Promise<ApprovalRuleRow[]> {
  const r = await apiFetch("/api/query/approval-rules")
  if (!r.ok) throw new Error(await parseCallError(r))
  const j = (await r.json()) as { data?: ApprovalRuleRow[] }
  return j.data ?? []
}

export function useApprovalRules(organizationId: number, enabled = true) {
  return useQuery({
    queryKey: ["approval-rules", String(organizationId)],
    queryFn: fetchApprovalRulesRows,
    enabled: enabled && organizationId > 0,
  })
}

export function useCreateApprovalRule(organizationId: number, companyId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const params = toCreateApprovalRuleParams(input)
      if (!params) throw new Error("Invalid approval rule params")
      const { urlPath, init } = approvalsBffPost("create_approval_rule", [
        organizationId,
        companyId ?? null,
        stdbParamsToJson(params, "CreateApprovalRuleParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["approval-rules", String(organizationId)] })
    },
  })
}

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
    default:
      return undefined
  }
}

export function isAiDraftApprovalRequest(row: ApprovalRequestRow): boolean {
  return (row.model ?? "") === "ai_action_draft"
}
