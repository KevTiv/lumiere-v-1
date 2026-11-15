"use client"

import { decodeQueryListResponse } from "@lumiere/api-client"
import { httpResponseError } from "@lumiere/api-client/response-error"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, type QueryRow } from "../http"

type AiAgentRunRow = {
  id: string
  companyId: number
  runKey: string
  status: string
  summary?: string
  stepCount?: number
}

export function agentRunCanBeCancelled(status: string): boolean {
  return ["pending", "running", "awaiting_approval", "waiting_input", "interrupted", "agent_settled"].includes(status)
}

function aiAgentRunsQueryKey(organizationId: number, companyId: number | null) {
  return ["ai-agent-runs", organizationId, companyId] as const
}

export function aiAgentRunsQueryOptions(
  organizationId: number,
  companyId: number | null,
  actorId: string | null | undefined,
) {
  const enabled = Number.isSafeInteger(organizationId) && organizationId > 0
    && companyId !== null && Number.isSafeInteger(companyId) && companyId > 0 && Boolean(actorId)
  return {
    queryKey: [...aiAgentRunsQueryKey(organizationId, companyId), actorId] as const,
    enabled,
    queryFn: async () => {
      if (!enabled || companyId === null) throw new Error("Select a company to view its agent runs.")
      const response = await apiFetch(`/api/query/ai-agent-runs?companyId=${companyId}`)
      if (!response.ok) throw await httpResponseError(response, "Failed to fetch AI agent runs")
      return decodeQueryListResponse(await response.json(), (value): AiAgentRunRow => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI agent run")
        const row = value as QueryRow
        const id = parseStrictU64(row.id)
        const runKey = row.runKey ?? row.run_key
        const stepCount = row.stepCount ?? row.step_count
        if (!id || parseStrictU64(row.companyId ?? row.company_id) !== BigInt(companyId)
          || typeof row.status !== "string" || typeof runKey !== "string") {
          throw new Error("AI agent run data could not be verified for this company")
        }
        return {
          id: id.toString(),
          companyId,
          status: row.status,
          runKey,
          summary: typeof row.summary === "string" ? row.summary : undefined,
          stepCount: typeof stepCount === "number" ? stepCount : undefined,
        }
      })
    },
    refetchInterval: 5_000,
  }
}

export function useAiAgentRuns(...scope: Parameters<typeof aiAgentRunsQueryOptions>) {
  return useQuery(aiAgentRunsQueryOptions(...scope))
}

export function useCancelAiAgentRun(organizationId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ companyId, runId }: { companyId: number; runId: string }) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_ai_agent_run", {
        companyId,
        runId,
        reason: "Cancelled from UI",
      })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw await httpResponseError(response, "Failed to cancel AI agent run")
    },
    onSuccess: (_data, { companyId }) => {
      return queryClient.invalidateQueries({ queryKey: aiAgentRunsQueryKey(organizationId, companyId) })
    },
  })
}
