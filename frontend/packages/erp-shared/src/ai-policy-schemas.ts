/**
 * Typed AI policy schemas mirrored from `ai-gateway/src/harness/*`.
 *
 * These describe the controlled policy evaluation contract used by the protected
 * AI policy BFF. Browser code sends skill/plan/output candidates; the server
 * derives organization/company scope from the session and returns a typed
 * decision, protected output, and privacy report.
 */

export interface SkillVersionRef {
  skillKey: string
  version: number
}

export type ReviewStatus = "draft" | "reviewed" | "promoted" | "retired"

export interface ReviewMetadata {
  status: ReviewStatus
  reviewedBy: string
  reviewedAt: string
}

export type RiskClass = "green" | "amber" | "red"

export type Capability =
  | "named_read"
  | "action_draft"
  | "action_execute"
  | "raw_sql"
  | "network"
  | "filesystem"

export interface ExecutionLimits {
  maxRows: number
  maxSteps: number
  maxToolCalls: number
}

export interface PrivacyPolicy {
  allowedFields: string[]
  maskPhoneFields: boolean
  maskPaymentReferences: boolean
  suppressSecrets: boolean
}

export interface PlannedToolCall {
  toolName: string
  capability: Capability
  namedResource?: string
}

export interface ExecutionPlan {
  namedResources: string[]
  toolCalls: PlannedToolCall[]
  steps: number
  expectedRows: number
  outputType: string
}

export interface ApprovalMetadata {
  approvalId: string
  approvedBy: string
  approvedAt: string
}

export interface CorrectionMetadata {
  correctionId: string
  correctedBy: string
  correctedAt: string
  reason: string
}

export interface ExecutionMetadata {
  actorId?: string
  causationId?: string
  approval?: ApprovalMetadata
  correction?: CorrectionMetadata
}

/**
 * Browser-visible policy execution request. The BFF fills `organizationId`,
 * `companyId`, and `actorId` from the session before forwarding to the gateway.
 */
export interface PolicyExecutionRequest {
  skill: SkillVersionRef
  organizationId: number
  companyId: number
  correlationId: string
  metadata: ExecutionMetadata
  input: unknown
  plan: ExecutionPlan
}

export interface PolicyControlledRequest {
  execution: PolicyExecutionRequest
  candidateOutput: unknown
}

export type DecisionOutcome = "allow" | "draft_only" | "deny"

export type PolicyReasonCode =
  | "allowed"
  | "draft_only"
  | "invalid_context"
  | "unknown_skill_version"
  | "version_not_promoted"
  | "invalid_manifest"
  | "named_resource_required"
  | "resource_not_allowed"
  | "unknown_resource"
  | "resource_not_promoted"
  | "output_contract_mismatch"
  | "capability_denied"
  | "tool_denied"
  | "row_limit_exceeded"
  | "step_limit_exceeded"
  | "tool_call_limit_exceeded"
  | "output_type_mismatch"
  | "invalid_input"
  | "invalid_output"
  | "red_approval_required"
  | "red_execution_unavailable"
  | "cross_company_row"
  | "privacy_violation"

export interface DecisionReason {
  code: PolicyReasonCode
  message: string
}

export interface CorrelationMetadata {
  correlationId: string
  organizationId: number
  companyId: number
  actorId?: string
  causationId?: string
}

export interface DecisionHashes {
  requestHash: string
  inputHash: string
  manifestHash?: string
}

export interface PolicyDecision {
  outcome: DecisionOutcome
  skill: SkillVersionRef
  risk?: RiskClass
  reasons: DecisionReason[]
  correlation: CorrelationMetadata
  hashes: DecisionHashes
  enforcedLimits?: ExecutionLimits
}

export interface PrivacyReport {
  rowsProcessed: number
  maskedFields: string[]
  suppressedFields: string[]
}

export interface ActionDraftProposal {
  reducerName: string
  paramsJson: string
  summary: string
  elevated: boolean
  warnings: string[]
}

export interface PolicyResult {
  decision: PolicyDecision
  output?: unknown
  privacy?: PrivacyReport
  actionDraft?: ActionDraftProposal
  outputHash?: string
  resultHash: string
}

// ── Request builders ─────────────────────────────────────────────────────────

export function buildPolicyControlledRequest(
  skill: SkillVersionRef,
  companyId: number,
  correlationId: string,
  input: unknown,
  plan: ExecutionPlan,
  candidateOutput: unknown,
  metadata?: ExecutionMetadata,
): PolicyControlledRequest {
  return {
    execution: {
      skill,
      organizationId: 0, // filled by the BFF from session
      companyId,
      correlationId,
      metadata: metadata ?? {},
      input,
      plan,
    },
    candidateOutput,
  }
}
