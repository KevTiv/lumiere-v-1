"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@/lib/stdb-params-json"

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
      const r = await fetch("/api/query/ai-agents")
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
      const r = await fetch("/api/call/create_ai_agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), null, stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useUpdateAiAgent(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; params: Record<string, unknown> }) => {
      const r = await fetch("/api/call/update_ai_agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          String(organizationId),
          String(args.agentId),
          stdbParamsToJson(args.params as object),
        ]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}

export function useSetAiAgentActive(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { agentId: number; isActive: boolean }) => {
      const r = await fetch("/api/call/set_ai_agent_active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), String(args.agentId), args.isActive]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateAiAgents(qc, organizationId),
  })
}
