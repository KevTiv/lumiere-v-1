"use client"



import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { AiAgent } from "@lumiere/stdb/types"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function stdbQueryKey(resource: string, organizationId: number) {
  return ["stdb", resource, String(organizationId)] as const
}

/** For refresh flows that refetch agents alongside other data. */
export function aiAgentsQueryKey(organizationId: number) {
  return stdbQueryKey("ai-agents", organizationId)
}

export function useAiAgents(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: aiAgentsQueryKey(organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/ai-agents")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: AiAgent[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

function invalidateAiAgents(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  void qc.invalidateQueries({ queryKey: aiAgentsQueryKey(organizationId) })
}

export function useCreateAiAgent(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_ai_agent", { companyId: null, params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useUpdateAiAgent(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_ai_agent", { agentId: args.agentId, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useSetAiAgentActive(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; isActive: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_ai_agent_active", { agentId: args.agentId, isActive: args.isActive })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useCreateAiTeamMember(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("create_ai_team_member", { companyId: args.companyId != null ? args.companyId : null, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useDismissAiInsight(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; insightId: number }) => {
      const { urlPath, init } = stdbBffCommandPost("dismiss_insight", { companyId: args.companyId != null ? args.companyId : null, insightId: args.insightId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useCreateAiInsight(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; params: Record<string, unknown> }) => {
      const { urlPath, init } = stdbBffCommandPost("create_ai_insight", { companyId: args.companyId != null ? args.companyId : null, params: stdbParamsToJson(args.params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useRecordAiSpend(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; tokensUsed: number }) => {
      const { urlPath, init } = stdbBffCommandPost("record_ai_spend", { agentId: args.agentId, tokensUsed: args.tokensUsed })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}
