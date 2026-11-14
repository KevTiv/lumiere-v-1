"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
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
  execution_route?: string
  legacy_run_supported: boolean
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

export type LegacyAiSkillRunRetirement = {
  code: "legacy_skill_run_retired"
  skill_key: string
  replacement_path?: string
  error: string
}

const GOVERNED_SKILL_BFF_ROUTES: Readonly<Record<string, string>> = {
  report_composer: "/api/ai/report/compose",
  low_stock: "/api/ai/inventory/low-stock",
  import_mapping: "/api/ai/skills/import-mapping",
  insights_scan: "/api/ai/skills/insights-scan",
  daily_briefing: "/api/ai/skills/daily-briefing",
  report_analysis: "/api/ai/skills/report-analysis",
  finance_report_review: "/api/ai/skills/finance/finance_report_review",
  bank_reconciliation_review: "/api/ai/skills/finance/bank_reconciliation_review",
  period_close_review: "/api/ai/skills/finance/period_close_review",
  expense_evidence_review: "/api/ai/skills/finance/expense_evidence_review",
  finance_variance_review: "/api/ai/skills/finance/finance_variance_review",
  process_research: "/api/ai/skills/process-research",
  price_search: "/api/ai/skills/price-search",
  supplier_discovery: "/api/ai/skills/supplier-discovery",
  rag_generation: "/api/ai/rag",
  form_suggestion: "/api/ai/forms/suggest",
  action_draft_generation: "/api/ai/actions/draft",
}

export function legacyAiSkillRunRetirement(skillKey: string): LegacyAiSkillRunRetirement {
  const normalized = skillKey.trim()
  const replacementPath = Object.hasOwn(GOVERNED_SKILL_BFF_ROUTES, normalized)
    ? GOVERNED_SKILL_BFF_ROUTES[normalized]
    : undefined
  return {
    code: "legacy_skill_run_retired",
    skill_key: normalized,
    ...(replacementPath ? { replacement_path: replacementPath } : {}),
    error: replacementPath
      ? `Skill '${normalized}' no longer runs through the legacy skill hook; use ${replacementPath}.`
      : `Skill '${normalized}' has no governed execution adapter.`,
  }
}

export class LegacyAiSkillRunRetiredError extends Error {
  readonly retirement: LegacyAiSkillRunRetirement

  constructor(retirement: LegacyAiSkillRunRetirement) {
    super(retirement.error)
    this.name = "LegacyAiSkillRunRetiredError"
    this.retirement = retirement
  }
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

export function useRegisteredAiSkills(organizationId: number) {
  const validOrganization = Number.isSafeInteger(organizationId) && organizationId > 0
  return useQuery({
    queryKey: aiSkillsQueryKey(organizationId),
    enabled: validOrganization,
    queryFn: async (): Promise<AiSkillListItem[]> => {
      if (!validOrganization) throw new Error("An organization is required to read registered skills")
      // Administration reads canonical registered rows while the runtime can
      // remain disabled. The API still owns tenant and field authorization.
      const rows = await fetchQueryList("/api/query/ai-skills", "Failed to read registered AI skills")
      return rows.map((row) => {
        const id = Number(row.id)
        if (!Number.isSafeInteger(id) || id <= 0 || typeof row.skillKey !== "string" || !row.skillKey.trim()
          || typeof row.name !== "string" || !row.name.trim() || typeof row.category !== "string"
          || typeof row.isSystem !== "boolean") {
          throw new Error("Registered AI skills are not fully readable")
        }
        return {
          id, skill_key: row.skillKey, name: row.name, category: row.category,
          description: row.description ?? undefined, is_system: row.isSystem,
          source: "stdb",
          execution_route: legacyAiSkillRunRetirement(row.skillKey).replacement_path,
          legacy_run_supported: false,
        }
      })
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
      // Compatibility export only. Keeping this hook fail-fast avoids a
      // misleading network request to the permanently retired endpoint.
      throw new LegacyAiSkillRunRetiredError(legacyAiSkillRunRetirement(args.skillKey))
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

export function useSyncAiSkills(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/skills/sync", { method: "POST" })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { synced: string[]; skills_dir: string }
    },
    onSettled: () => invalidateAiSkillCatalogs(qc, organizationId),
  })
}

const AI_SURFACE_SKILL_KEYS = ["rag_generation", "form_suggestion", "action_draft_generation"] as const
type AiSurfaceSkillKey = (typeof AI_SURFACE_SKILL_KEYS)[number]

export type AiSurfaceProvisioningResult = {
  company_setup?: {
    company_id: number
    status: "bindings_applied" | "profile_required" | "preserved"
    stage: "company_defaults_checked" | "platform_activation_required"
    execution_readiness: "not_verified"
    message: string
  }
  skills: {
    skill_key: AiSurfaceSkillKey
    skill_id: number
    status: "created" | "existing" | "inactive"
  }[]
}

type AiSurfaceProvisioningSkillInput = {
  skill_key?: unknown
  skill_id?: unknown
  status?: unknown
}

export function parseAiSurfaceProvisioningResult(value: unknown): AiSurfaceProvisioningResult {
  const skills = value && typeof value === "object" && "skills" in value ? value.skills : undefined
  const invalid = () => new Error("AI feature setup could not be verified. Refresh the skills list and try again.")
  const companySetup = value && typeof value === "object" && "company_setup" in value ? value.company_setup : undefined
  if (!Array.isArray(skills) || skills.length > AI_SURFACE_SKILL_KEYS.length
    || (companySetup === undefined && skills.length !== AI_SURFACE_SKILL_KEYS.length)) throw invalid()

  const seen = new Set<string>()
  const result = skills.map((value: unknown): AiSurfaceProvisioningResult["skills"][number] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
    const skill = value as AiSurfaceProvisioningSkillInput
    if (typeof skill.skill_key !== "string"
      || !AI_SURFACE_SKILL_KEYS.some((key) => key === skill.skill_key)
      || typeof skill.skill_id !== "number" || !Number.isSafeInteger(skill.skill_id) || skill.skill_id <= 0
      || (skill.status !== "created" && skill.status !== "existing" && skill.status !== "inactive")
      || seen.has(skill.skill_key)) throw invalid()
    seen.add(skill.skill_key)
    return { skill_key: skill.skill_key as AiSurfaceSkillKey, skill_id: skill.skill_id, status: skill.status }
  })
  const setup = value && typeof value === "object" && "company_setup" in value ? value.company_setup : undefined
  if (setup === undefined) return { skills: result }
  if (!setup || typeof setup !== "object"
    || !("company_id" in setup) || typeof setup.company_id !== "number"
    || !Number.isSafeInteger(setup.company_id) || setup.company_id <= 0
    || !("status" in setup) || (setup.status !== "bindings_applied" && setup.status !== "profile_required" && setup.status !== "preserved")
    || !("stage" in setup) || (setup.stage !== "company_defaults_checked" && setup.stage !== "platform_activation_required")
    || !("execution_readiness" in setup) || setup.execution_readiness !== "not_verified"
    || !("message" in setup) || typeof setup.message !== "string") throw invalid()
  if (setup.status === "bindings_applied" && result.length !== AI_SURFACE_SKILL_KEYS.length) throw invalid()
  return { skills: result, company_setup: {
    company_id: setup.company_id, status: setup.status, message: setup.message,
    stage: setup.stage, execution_readiness: setup.execution_readiness,
  } }
}

export function useProvisionAiSurfaces(organizationId: number, companyId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ["ai-surface-provisioning", String(organizationId), companyId],
    retry: false,
    mutationFn: async (): Promise<AiSurfaceProvisioningResult> => {
      if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new Error("An organization is required to set up AI features")
      }
      if (companyId !== undefined && (!Number.isSafeInteger(companyId) || companyId <= 0)) {
        throw new Error("A company is required to set up AI features")
      }
      const response = await apiFetch("/api/ai/skills/provision-surfaces", {
        method: "POST",
        ...(companyId === undefined ? {} : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        }),
      })
      if (!response.ok) throw new Error(await parseAiError(response))
      const result = parseAiSurfaceProvisioningResult(await response.json())
      if (companyId !== undefined && result.company_setup?.company_id !== companyId) {
        throw new Error("Company AI setup could not be verified. Retry setup for the current company.")
      }
      return result
    },
    // A lost or failed reply may follow a partial setup. Refresh the saved
    // catalog in both cases instead of assuming that no records changed.
    onSettled: () => Promise.all([
      invalidateAiSkillCatalogs(qc, organizationId),
      qc.invalidateQueries({ queryKey: ["stdb", "ai-agents", String(organizationId)] }),
    ]),
  })
}

function invalidateAiSkillCatalogs(queryClient: QueryClient, organizationId: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: aiSkillsQueryKey(organizationId) }),
    queryClient.invalidateQueries({ queryKey: ["ai-skills"] }),
  ])
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
      const { urlPath, init } = stdbBffCommandPost("create_ai_skill", { params: stdbParamsToJson(params, "CreateAiSkillParams") })
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
      const { urlPath, init } = stdbBffCommandPost("upsert_ai_skill", { params: stdbParamsToJson(params, "UpsertAiSkillParams") })
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
      const { urlPath, init } = stdbBffCommandPost("assign_team_member_skill", { params: stdbParamsToJson(params, "AssignTeamMemberSkillParams") })
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

/** Typed pre-dispatch rejection; unlike transport failure it proves no run started. */
export class AiReportReadinessBlockedError extends Error {
  constructor(public readonly readiness: unknown) {
    super("Report analysis was blocked before dispatch")
    this.name = "AiReportReadinessBlockedError"
  }
}

async function postHarnessSkill<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    if (path === "/api/ai/skills/report-analysis" && r.status === 409) {
      const blocked: unknown = await r.clone().json().catch(() => null)
      if (blocked && typeof blocked === "object" && "analysisStarted" in blocked && blocked.analysisStarted === false && "readiness" in blocked) {
        throw new AiReportReadinessBlockedError(blocked.readiness)
      }
    }
    throw new Error(await parseAiError(r))
  }
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
    retry: false,
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

export type FinanceReviewSkill =
  | "finance_report_review"
  | "bank_reconciliation_review"
  | "period_close_review"
  | "expense_evidence_review"
  | "finance_variance_review"

export function useAiFinanceReview(skill: FinanceReviewSkill) {
  return useGovernedLlmSkill(`/api/ai/skills/finance/${skill}`)
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
