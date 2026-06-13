"use client"


import { aiAgentsBffPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  return j.error ?? `Request failed (${r.status})`
}

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
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
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
      const { urlPath, init } = aiAgentsBffPost("create_ai_agent", [
        organizationId,
        null,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = aiAgentsBffPost("update_ai_agent", [
        organizationId,
        args.agentId,
        stdbParamsToJson(args.params as object),
      ])
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
      const { urlPath, init } = aiAgentsBffPost("set_ai_agent_active", [
        organizationId,
        args.agentId,
        args.isActive,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useCreateAiTeamMember(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; params: Record<string, unknown> }) => {
      const { urlPath, init } = aiAgentsBffPost("create_ai_team_member", [
        organizationId,
        args.companyId != null ? args.companyId : null,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useDismissAiInsight(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; insightId: number }) => {
      const { urlPath, init } = aiAgentsBffPost("dismiss_insight", [
        organizationId,
        args.companyId != null ? args.companyId : null,
        args.insightId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useCreateAiInsight(organizationId: number) {
  return useMutation({
    mutationFn: async (args: { companyId: number | null; params: Record<string, unknown> }) => {
      const { urlPath, init } = aiAgentsBffPost("create_ai_insight", [
        organizationId,
        args.companyId != null ? args.companyId : null,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
  })
}

export function useRecordAiSpend(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; tokensUsed: number }) => {
      const { urlPath, init } = aiAgentsBffPost("record_ai_spend", [
        organizationId,
        args.agentId,
        args.tokensUsed,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}
