"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  AiTeamMember,
  AiTeamMemberSkill,
  AssignTeamMemberSkillParams,
  CreateAiSkillParams,
  UpsertAiSkillParams,
} from "@lumiere/stdb/types"
import type {
  DailyBriefingResult,
  GovernedLlmSkillInput,
  GovernedLlmSkillResult,
  ImportMappingResult,
  InsightsScanHarnessResult,
} from "@lumiere/erp-shared/ai-skill-harness-schemas"
import { responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"

export type {
  DailyBriefingResult,
  GovernedLlmSkillInput,
  GovernedLlmSkillResult,
  ImportMappingResult,
  InsightsScanHarnessResult,
}

export type AiSkillListItem = {
  id: number
  skill_key: string
  name: string
  description?: string
  category: string
  is_system: boolean
  source?: string
}

export type AiSkillCitation = {
  kind: string
  trust: string
  content_type?: string
  entity_id?: string
  score?: number
  text_snippet?: string
  label?: string
  snapshot_at?: string
  url?: string
  title?: string
  fetched_at?: string
}

export type AiSkillArtifact = {
  kind: string
  title: string
  content: unknown
}

export type AiSkillRunStep = {
  step_no: number
  tool: string
  duration_ms: number
  summary: string
}

export type AiSkillRunResponse = {
  run_id: number
  run_key: string
  status: string
  summary: string
  artifacts: AiSkillArtifact[]
  citations: AiSkillCitation[]
  steps: AiSkillRunStep[]
  agent_id: number
  skill_key: string
}

export function useAiSkills() {
  return useQuery({
    queryKey: ["ai-skills"],
    queryFn: async () => {
      const r = await apiFetch("/api/ai/skills")
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiSkillListItem[]
    },
    staleTime: 60_000,
  })
}

export function useRunAiSkill() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      skillKey: string
      inputs?: Record<string, unknown>
      agentId?: number
      teamMemberId?: number
      overrides?: { max_steps?: number }
    }) => {
      const r = await apiFetch("/api/ai/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          skillKey: args.skillKey,
          ...(args.inputs ? { inputs: args.inputs } : {}),
          ...(args.agentId != null ? { agentId: args.agentId } : {}),
          ...(args.teamMemberId != null ? { teamMemberId: args.teamMemberId } : {}),
          ...(args.overrides ? { overrides: args.overrides } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiSkillRunResponse
    },
  })
}

export function useUpsertAiSkillConfig() {
  return useMutation({
    mutationFn: async (args: {
      companyId?: number
      skillId: number
      isEnabled?: boolean
      configJson: Record<string, unknown> | string
      customInstructions?: string
    }) => {
      const r = await apiFetch("/api/ai/skills/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(args.companyId != null ? { companyId: args.companyId } : {}),
          skillId: args.skillId,
          isEnabled: args.isEnabled,
          configJson:
            typeof args.configJson === "string"
              ? args.configJson
              : JSON.stringify(args.configJson),
          ...(args.customInstructions ? { customInstructions: args.customInstructions } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { ok: boolean }
    },
  })
}

export function useSyncAiSkills() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/skills/sync", { method: "POST" })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { synced: string[]; skills_dir: string }
    },
  })
}

function aiSkillsQueryKey(organizationId: number) {
  return ["ai-skills-stdb", String(organizationId)] as const
}

function aiTeamMemberSkillsQueryKey(organizationId: number) {
  return ["ai-team-member-skills", String(organizationId)] as const
}

export function useAiTeamMembers(organizationId: bigint, enabled = true) {
  return useQuery<AiTeamMember[]>({
    queryKey: ["ai-team-members", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/ai-team-members", "Failed to fetch AI team members"),
    staleTime: 30_000,
    enabled: enabled && organizationId > 0n,
  })
}

export function useAiTeamMemberSkills(organizationId: bigint, enabled = true) {
  return useQuery<AiTeamMemberSkill[]>({
    queryKey: aiTeamMemberSkillsQueryKey(Number(organizationId)),
    queryFn: () =>
      fetchQueryList("/api/query/ai-team-member-skills", "Failed to fetch team member skills"),
    staleTime: 30_000,
    enabled: enabled && organizationId > 0n,
  })
}

export function useCreateAiSkill(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAiSkillParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_ai_skill", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiSkillsQueryKey(organizationId) })
      void qc.invalidateQueries({ queryKey: ["ai-skills"] })
    },
  })
}

export function useUpsertAiSkill(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: UpsertAiSkillParams) => {
      const { urlPath, init } = stdbBffCommandPost("upsert_ai_skill", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiSkillsQueryKey(organizationId) })
      void qc.invalidateQueries({ queryKey: ["ai-skills"] })
    },
  })
}

export function useSetAiSkillActive(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { skillId: number; active: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_ai_skill_active", { skillId: args.skillId, active: args.active })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiSkillsQueryKey(organizationId) })
      void qc.invalidateQueries({ queryKey: ["ai-skills"] })
    },
  })
}

export function useAssignTeamMemberSkill(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: AssignTeamMemberSkillParams) => {
      const { urlPath, init } = stdbBffCommandPost("assign_team_member_skill", { params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: aiTeamMemberSkillsQueryKey(organizationId),
      })
    },
  })
}

export function useUnassignTeamMemberSkill(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamMemberSkillId: number) => {
      const { urlPath, init } = stdbBffCommandPost("unassign_team_member_skill", { teamMemberSkillId: teamMemberSkillId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: aiTeamMemberSkillsQueryKey(organizationId),
      })
    },
  })
}

export type AiAgentRunRow = {
  id: number
  run_key: string
  status: string
  summary?: string
  step_count?: number
  error_message?: string
}

export function useAiAgentRuns(organizationId?: number) {
  return useQuery({
    queryKey: ["ai-agent-runs", organizationId],
    enabled: organizationId != null && organizationId > 0,
    queryFn: async () => {
      const r = await apiFetch(`/api/query/ai-agent-runs?organizationId=${organizationId}`)
      if (!r.ok) throw new Error(await parseAiError(r))
      const json = (await r.json()) as { data?: AiAgentRunRow[] }
      return json.data ?? []
    },
    refetchInterval: 5_000,
  })
}

export function useCancelAiAgentRun(organizationId: number, companyId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (runId: number) => {
      if (companyId == null || companyId <= 0) {
        throw new Error("A valid company is required to cancel an AI agent run")
      }
      const { urlPath, init } = stdbBffCommandPost("cancel_ai_agent_run", {
        companyId,
        runId,
        reason: "Cancelled from UI",
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseAiError(r))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ai-agent-runs", organizationId] })
    },
  })
}

// ── Harness skill runs (dedicated /api/ai/skills/* routes) ───────────────────

async function postHarnessSkill<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await parseAiError(r))
  return (await r.json()) as T
}

export function useAiImportMapping() {
  return useMutation({
    mutationFn: async (input: {
      companyId: number
      targetEntity: string
      csvText?: string
      headers?: string[]
      sampleRows?: string[][]
      mapping?: Record<string, unknown>
      priorMappings?: Record<string, unknown>
      bundleKey?: string
      maxRows?: number
    }) => postHarnessSkill<ImportMappingResult>("/api/ai/skills/import-mapping", input),
  })
}

export function useAiInsightsScan() {
  return useMutation({
    mutationFn: async (input: {
      companyId: number
      maxInsights?: number
      abnormalAmountThreshold?: number
    }) =>
      postHarnessSkill<InsightsScanHarnessResult>("/api/ai/skills/insights-scan", input),
  })
}

export function useAiDailyBriefing() {
  return useMutation({
    mutationFn: async (input: {
      companyId: number
      sinceMicros?: number
      untilMicros?: number
      allowedModules?: string[]
      activityQuery?: string
      topK?: number
    }) => postHarnessSkill<DailyBriefingResult>("/api/ai/skills/daily-briefing", input),
  })
}

function useGovernedLlmSkill(path: string) {
  return useMutation({
    mutationFn: async (input: GovernedLlmSkillInput) =>
      postHarnessSkill<GovernedLlmSkillResult>(path, {
        ...input,
        inputs: input.inputs ?? {},
      }),
  })
}

export function useAiReportAnalysis() {
  return useGovernedLlmSkill("/api/ai/skills/report-analysis")
}

export function useAiProcessResearch() {
  return useGovernedLlmSkill("/api/ai/skills/process-research")
}

export function useAiPriceSearch() {
  return useGovernedLlmSkill("/api/ai/skills/price-search")
}

export function useAiSupplierDiscovery() {
  return useGovernedLlmSkill("/api/ai/skills/supplier-discovery")
}
