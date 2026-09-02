/**
 * Shared schemas for dedicated harness skill routes under `/api/ai/skills/*`.
 */

import type { PolicyResult } from "./ai-policy-schemas"
import type { HarnessAuditTrail } from "./ai-report-composer-schemas"

export interface GovernedLlmSkillInput {
  companyId: number
  inputs?: Record<string, unknown>
  agentId?: number
  teamMemberId?: number
  maxSteps?: number
}

export interface GovernedLlmSkillRun {
  run_id: number
  run_key: string
  status: string
  summary: string
  artifacts: Array<{ kind: string; title: string; content: unknown }>
  citations: unknown[]
  steps: Array<{
    step_no: number
    tool: string
    duration_ms: number
    summary: string
  }>
  agent_id: number
  skill_key: string
}

export interface GovernedLlmSkillResult {
  decision: PolicyResult
  summary: string
  run?: GovernedLlmSkillRun | null
  audit: HarnessAuditTrail
}

export interface InsightsScanHarnessResult {
  decision: PolicyResult
  summary: string
  scan: {
    created_count: number
    skipped_count: number
    candidate_count: number
    counts: Array<{ detector_id: string; count: number }>
    preview_insights: unknown[]
    persisted: boolean
    warnings: string[]
  }
  audit: HarnessAuditTrail
}

export interface DailyBriefingResult {
  decision: PolicyResult
  summary: string
  briefing: {
    summary_md: string
    sections: unknown[]
    sources: unknown[]
    activity_query: string
    source_count: number
    retrieval_degraded: boolean
  }
  audit: HarnessAuditTrail
}

export interface ImportMappingResult {
  decision: PolicyResult
  summary: string
  payload: unknown
  audit: HarnessAuditTrail
}

export type { PolicyResult, HarnessAuditTrail }
