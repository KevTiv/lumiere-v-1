import type { TFunction } from "i18next"

function labelFromMap(t: TFunction, value: string, keys: Record<string, string>): string {
  const key = keys[value]
  return key ? t(key) : value
}

const EVIDENCE_METHOD_KEYS: Record<string, string> = {
  none: "aiHarness.enums.verificationMethods.none",
  deterministic: "aiHarness.enums.verificationMethods.deterministic",
  model_assisted: "aiHarness.enums.verificationMethods.modelAssisted",
  human_reviewed: "aiHarness.enums.verificationMethods.humanReviewed",
}

const EVIDENCE_OUTCOME_KEYS: Record<string, string> = {
  unverified: "aiHarness.enums.verificationOutcomes.unverified",
  supported: "aiHarness.enums.verificationOutcomes.supported",
  qualified: "aiHarness.enums.verificationOutcomes.qualified",
  unsupported: "aiHarness.enums.verificationOutcomes.unsupported",
  unresolved: "aiHarness.enums.verificationOutcomes.unresolved",
  traceable: "aiHarness.enums.verificationOutcomes.traceable",
}

const EVIDENCE_STATUS_KEYS: Record<string, string> = {
  proposed: "aiHarness.enums.evidenceStatuses.proposed",
  accepted: "aiHarness.enums.evidenceStatuses.accepted",
  rejected: "aiHarness.enums.evidenceStatuses.rejected",
  superseded: "aiHarness.enums.evidenceStatuses.superseded",
  needs_review: "aiHarness.enums.evidenceStatuses.needsReview",
  current: "aiHarness.enums.evidenceStatuses.current",
  invalid: "aiHarness.enums.evidenceStatuses.invalid",
}

const RUN_STATUS_KEYS: Record<string, string> = {
  pending: "aiHarness.enums.runStatuses.pending",
  ready: "aiHarness.enums.runStatuses.ready",
  running: "aiHarness.enums.runStatuses.running",
  waiting_input: "aiHarness.enums.runStatuses.waitingInput",
  waiting_approval: "aiHarness.enums.runStatuses.waitingApproval",
  interrupted: "aiHarness.enums.runStatuses.interrupted",
  completed: "aiHarness.enums.runStatuses.completed",
  cancelled: "aiHarness.enums.runStatuses.cancelled",
  failed: "aiHarness.enums.runStatuses.failed",
  agent_settled: "aiHarness.enums.runStatuses.agentSettled",
  budget_parked: "aiHarness.enums.runStatuses.budgetParked",
}

const QUESTION_STATUS_KEYS: Record<string, string> = {
  open: "aiHarness.enums.questionStatuses.open",
  answered: "aiHarness.enums.questionStatuses.answered",
  skipped: "aiHarness.enums.questionStatuses.skipped",
}

const EVENT_KIND_KEYS: Record<string, string> = {
  initialized: "aiHarness.enums.eventKinds.initialized",
  checkpoint: "aiHarness.enums.eventKinds.checkpoint",
  question_asked: "aiHarness.enums.eventKinds.questionAsked",
  question_replied: "aiHarness.enums.eventKinds.questionReplied",
  steered: "aiHarness.enums.eventKinds.steered",
  interrupted: "aiHarness.enums.eventKinds.interrupted",
  resumed: "aiHarness.enums.eventKinds.resumed",
  forked: "aiHarness.enums.eventKinds.forked",
  compared: "aiHarness.enums.eventKinds.compared",
}

const LINK_STATE_KEYS: Record<string, string> = {
  linked: "aiHarness.enums.linkStates.linked",
  changed: "aiHarness.enums.linkStates.changed",
  unresolved: "aiHarness.enums.linkStates.unresolved",
}

const AVAILABILITY_KEYS: Record<string, string> = {
  available: "aiHarness.enums.availability.available",
  restricted: "aiHarness.enums.availability.restricted",
  tombstoned: "aiHarness.enums.availability.tombstoned",
  out_of_scope: "aiHarness.enums.availability.outOfScope",
  missing: "aiHarness.enums.availability.missing",
}

const REVIEW_TARGET_KEYS: Record<string, string> = {
  claim: "aiHarness.enums.reviewTargets.claim",
  decision: "aiHarness.enums.reviewTargets.decision",
  component: "aiHarness.enums.reviewTargets.workflowStep",
}

const REVIEW_OUTCOME_KEYS: Record<string, string> = {
  supported: "aiHarness.enums.verificationOutcomes.supported",
  qualified: "aiHarness.enums.verificationOutcomes.qualified",
  unsupported: "aiHarness.enums.verificationOutcomes.unsupported",
  accepted: "aiHarness.enums.evidenceStatuses.accepted",
  rejected: "aiHarness.enums.evidenceStatuses.rejected",
  confirmed: "aiHarness.enums.reviewOutcomes.confirmed",
  unresolved: "aiHarness.enums.verificationOutcomes.unresolved",
}

const CLAIM_KIND_KEYS: Record<string, string> = {
  policy: "aiHarness.enums.claimKinds.policy",
  inference: "aiHarness.enums.claimKinds.inference",
  sourced_fact: "aiHarness.enums.claimKinds.sourcedFact",
  calculation: "aiHarness.enums.claimKinds.calculation",
  quotation: "aiHarness.enums.claimKinds.quotation",
  paraphrase: "aiHarness.enums.claimKinds.paraphrase",
  recommendation: "aiHarness.enums.claimKinds.recommendation",
  concept: "aiHarness.enums.claimKinds.concept",
}

const PROPOSER_KIND_KEYS: Record<string, string> = {
  agent: "aiHarness.enums.proposerKinds.agent",
  contributor: "aiHarness.enums.proposerKinds.contributor",
  human: "aiHarness.enums.proposerKinds.human",
  user: "aiHarness.enums.proposerKinds.user",
  system: "aiHarness.enums.proposerKinds.system",
}

const POLICY_OUTCOME_KEYS: Record<string, string> = {
  allow: "aiHarness.enums.policyOutcomes.allow",
  draft_only: "aiHarness.enums.policyOutcomes.draftOnly",
  deny: "aiHarness.enums.policyOutcomes.deny",
}

const RISK_CLASS_KEYS: Record<string, string> = {
  green: "aiHarness.enums.riskClasses.green",
  amber: "aiHarness.enums.riskClasses.amber",
  red: "aiHarness.enums.riskClasses.red",
}

export const evidenceMethodLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, EVIDENCE_METHOD_KEYS)

export const evidenceOutcomeLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, EVIDENCE_OUTCOME_KEYS)

export const evidenceStatusLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, EVIDENCE_STATUS_KEYS)

export const runStatusLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, RUN_STATUS_KEYS)

export const questionStatusLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, QUESTION_STATUS_KEYS)

export const eventKindLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, EVENT_KIND_KEYS)

export const linkStateLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, LINK_STATE_KEYS)

export const availabilityLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, AVAILABILITY_KEYS)

export const reviewTargetLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, REVIEW_TARGET_KEYS)

export const reviewOutcomeLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, REVIEW_OUTCOME_KEYS)

export const claimKindLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, CLAIM_KIND_KEYS)

export const proposerKindLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, PROPOSER_KIND_KEYS)

export const policyOutcomeLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, POLICY_OUTCOME_KEYS)

export const riskClassLabel = (t: TFunction, value: string) =>
  labelFromMap(t, value, RISK_CLASS_KEYS)

const ATTEMPT_STATUS_KEYS: Record<string, string> = {
  accepted: "aiHarness.enums.attemptStatuses.accepted",
  dispatched: "aiHarness.enums.attemptStatuses.dispatched",
  succeeded: "aiHarness.enums.attemptStatuses.succeeded",
  failed: "aiHarness.enums.attemptStatuses.failed",
  outcome_unknown: "aiHarness.enums.attemptStatuses.outcome_unknown",
  abandoned: "aiHarness.enums.attemptStatuses.abandoned",
}
export const attemptStatusLabel = (t: TFunction, value: string) => labelFromMap(t, value, ATTEMPT_STATUS_KEYS)

const RESERVATION_STATUS_KEYS: Record<string, string> = {
  reserved: "aiHarness.enums.reservationStatuses.reserved",
  settled: "aiHarness.enums.reservationStatuses.settled",
  released: "aiHarness.enums.reservationStatuses.released",
}
export const reservationStatusLabel = (t: TFunction, value: string) => labelFromMap(t, value, RESERVATION_STATUS_KEYS)

export function runStepOutcomeLabel(t: TFunction, step: { error: boolean; outputRowCount: number | null }): string {
  if (step.error) return t("aiHarness.runLifecycle.failed")
  if (step.outputRowCount === null) return t("aiHarness.runLifecycle.completed")
  return t("aiHarness.runMetrics.rows", { count: step.outputRowCount })
}
