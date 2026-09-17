"use client"

import { useMutation, useQuery } from "@tanstack/react-query"

import { apiFetch } from "../http"
import { responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

/**
 * Types and hooks for the AI agent run transcript, the admin "Runs" list and
 * the source/decision inspector (AIH-7/8/9/16). Shapes mirror the frozen
 * ai-gateway contract proxied by the Next.js BFF routes under
 * `/api/ai/runs` and `/api/ai/inspector`.
 */

/** Status allowlist shared by the runs BFF route and the gateway. */
export type AiRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval"
  | "agent_settled"

export const AI_RUN_STATUSES: readonly AiRunStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
  "agent_settled",
]

export type RunRow = {
  id: number
  run_key: string
  organization_id: number
  company_id: number
  skill_id: number
  skill_key: string | null
  skill_name: string | null
  agent_id: number
  agent_name: string | null
  status: string
  step_count: number
  tokens_used: number
  error_message: string | null
  summary: string | null
  /** Micros since unix epoch. */
  started_at: number
  /** Micros since unix epoch. */
  completed_at: number | null
  triggered_by_hex: string
}

export type StepRow = {
  id: number
  step_no: number
  tool_name: string
  input_hash: string
  output_summary: string
  output_row_count: number | null
  citations_json: string | null
  duration_ms: number
  error_message: string | null
  /** Micros since unix epoch. */
  created_at: number
}

export type AttemptRow = {
  id: number
  provider: string
  model: string
  status: string
  input_tokens: number
  output_tokens: number
  failure_reason: string | null
}

export type CostInfo = {
  available: boolean
  settled_units: number | null
  reserved_units: number | null
  currency: string | null
}

export type AiRunsResponse = {
  runs: RunRow[]
}

export type AiRunStepsResponse = {
  run: RunRow
  steps: StepRow[]
  attempts: AttemptRow[]
  cost: CostInfo
}

// ── Inspector payload (loose but useful; the gateway may add fields) ─────────

export type AiInspectorViewKind = "claim" | "decision" | "component" | "answer"

export type SourceAvailability = "available" | "denied" | "unavailable" | "recalled"

export type InspectionSourceVersion = {
  id: number
  availability: SourceAvailability | string | null
  kind: string | null
  title: string | null
  authors_json: string | null
  publisher: string | null
  publication_date: string | null
  edition: string | null
  version_label: string | null
  uri: string | null
  doi: string | null
}

export type InspectionSourcePassage = {
  id: number
  source_version_id: number
  availability: SourceAvailability | string | null
  passage_kind: string | null
  /** Only present when availability === "available" (withheld server-side otherwise). */
  content: string | null
  content_hash: string | null
  coordinates_json: string | null
  is_original: boolean | null
}

export type InspectionContribution = {
  id: number
  contributor_identity: string | null
  contributor_kind: string | null
  session_ref: string | null
  turn_ref: string | null
  event_ref: string | null
  inspection_state: string | null
  /** Micros since unix epoch. */
  introduced_at: number | null
}

export type InspectionDecisionSummary = {
  id: number
  status: string | null
  rationale_summary: string | null
}

export type InspectionValidation = {
  id: number
  run_id: number
  claim_id: number | null
  source_version_id: number | null
  source_passage_id: number | null
  check_kind: string | null
  outcome: string | null
  detail: string | null
}

export type InspectionGateResult = {
  id: number
  run_id: number
  gate_outcome: string | null
  failed_checks_json: string | null
  domain_review_required: boolean | null
}

export type ClaimView = {
  id: number
  kind: string | null
  statement: string
  assumptions_json: string | null
  verification_outcome: string | null
  status: string | null
  source_version: InspectionSourceVersion | null
  source_passage: InspectionSourcePassage | null
  contributions: InspectionContribution[]
  decisions: InspectionDecisionSummary[]
}

export type InspectionDecisionDetail = {
  id: number
  status: string | null
  applicability: string | null
  alternatives_json: string | null
  adaptations_json: string | null
  rationale: string | null
  contributor_identity: string | null
  reviewer_identity: string | null
  claim: ClaimView | null
  supporting_claims: ClaimView[]
  supporting_sources: InspectionSourceVersion[]
}

export type InspectionComponentDetail = {
  id: number
  component_key: string | null
  component_kind: string | null
  version: number | null
  content_hash: string | null
  status: string | null
  decision: InspectionDecisionDetail | null
  claim: ClaimView | null
}

/**
 * Union-ish payload: the gateway fills the branch matching `view_kind`.
 * For `view_kind === "claim"` the payload may be the ClaimView itself
 * (with optional context) — consumers should fall back to `payload.claim`.
 */
export type InspectionPayload = {
  // answer view
  run_id?: number | null
  run_status?: string | null
  gate_result?: InspectionGateResult | null
  validations?: InspectionValidation[]
  claims?: ClaimView[]
  // claim view
  claim?: ClaimView | null
  // decision view
  decision?: InspectionDecisionDetail | null
  // component view
  component?: InspectionComponentDetail | null
}

export type AiInspectorResponse = {
  correlation: string
  view_kind: string
  payload: InspectionPayload
}

// ── Runs list (manual refresh; no polling) ───────────────────────────────────

export type AiRunsFilters = {
  companyId?: number
  skillId?: number
  agentId?: number
  status?: AiRunStatus
  days?: number
  limit?: number
}

export function aiRunsQueryKey(filters: AiRunsFilters) {
  return [
    "ai-runs",
    filters.companyId ?? "all",
    filters.skillId ?? "all",
    filters.agentId ?? "all",
    filters.status ?? "all",
    filters.days ?? 7,
    filters.limit ?? 50,
  ] as const
}

export function useAiRuns(filters: AiRunsFilters) {
  return useQuery({
    queryKey: aiRunsQueryKey(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.companyId != null) params.set("companyId", String(filters.companyId))
      if (filters.skillId != null) params.set("skillId", String(filters.skillId))
      if (filters.agentId != null) params.set("agentId", String(filters.agentId))
      if (filters.status != null) params.set("status", filters.status)
      if (filters.days != null) params.set("days", String(filters.days))
      if (filters.limit != null) params.set("limit", String(filters.limit))
      const qs = params.toString()
      const r = await apiFetch(`/api/ai/runs${qs ? `?${qs}` : ""}`, {
        method: "GET",
        cache: "no-store",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      const json = (await r.json()) as AiRunsResponse
      return json.runs ?? []
    },
    // Manual list: fetch on mount/filter change and via explicit refetch only.
    refetchInterval: false,
  })
}

// ── Run steps (live transcript; polls while the run is in flight) ────────────

export function aiRunStepsQueryKey(runId: number, companyId: number) {
  return ["ai-run-steps", runId, companyId] as const
}

export function useAiRunSteps(runId: number, companyId: number) {
  return useQuery({
    queryKey: aiRunStepsQueryKey(runId, companyId),
    queryFn: async () => {
      const r = await apiFetch(`/api/ai/runs/${runId}/steps?companyId=${companyId}`, {
        method: "GET",
        cache: "no-store",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiRunStepsResponse
    },
    enabled: runId > 0 && companyId > 0,
    // AIH-7 live transcript: poll every 2s while the run is in flight.
    refetchInterval: (query) => {
      const status = query.state.data?.run.status
      return status === "pending" || status === "running" ? 2_000 : false
    },
  })
}

// ── Inspector (AIH-16) ───────────────────────────────────────────────────────

export type AiInspectorRequest = {
  companyId?: number
  viewKind: AiInspectorViewKind
  claimId?: number
  decisionId?: number
  componentId?: number
  runId?: number
}

export function useAiInspector() {
  return useMutation({
    mutationFn: async (request: AiInspectorRequest) => {
      const r = await apiFetch("/api/ai/inspector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(request.companyId != null ? { companyId: request.companyId } : {}),
          viewKind: request.viewKind,
          ...(request.claimId != null ? { claimId: request.claimId } : {}),
          ...(request.decisionId != null ? { decisionId: request.decisionId } : {}),
          ...(request.componentId != null ? { componentId: request.componentId } : {}),
          ...(request.runId != null ? { runId: request.runId } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiInspectorResponse
    },
  })
}
