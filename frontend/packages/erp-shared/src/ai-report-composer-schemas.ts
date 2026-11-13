/**
 * Typed schemas for the promoted `report_composer` green AI skill.
 *
 * Mirrored from `ai-gateway/src/harness/report_composer.rs`.
 */

import type {
  PolicyDecision,
  PolicyResult,
  PrivacyReport,
} from "./ai-policy-schemas"

export interface ReportComposerInput {
  reportKey: string
  companyId: number
  date: string
  timezone: string
}

export interface ReportSummaryItem {
  companyId: number
  label: string
  valueMinorUnits: number
  currencyId: number
  scale: number
}

export interface ReportComposerOutput {
  reportKey: string
  title: string
  items: ReportSummaryItem[]
}

export interface ReportCitation {
  source: string
  label: string
  valueMinorUnits: number
}

export interface HarnessAuditEvent {
  sequence: number
  phase: string
  message: string
}

export interface HarnessAuditTrail {
  correlationId: string
  events: HarnessAuditEvent[]
}

interface ReportEvidenceRef {
  kind: string
  id: string
}

export interface ReportSummaryVerification {
  outcome: "admitted" | "qualified" | "requires_review" | "blocked"
  methods: string[]
  limitations?: string[]
  reason?: string
}

export interface ReportSummaryProvenance {
  claims: {
    text: string
    supportRefs: ReportEvidenceRef[]
    verificationMethod: string
    verificationOutcome: string
    limitations?: string[]
  }[]
  citations: ReportEvidenceRef[]
  persisted: boolean
  persistenceReason?: string
  contributionId?: number
  claimIds?: number[]
}

export interface ReportComposerResult {
  decision: PolicyResult
  summary: string
  citations: ReportCitation[]
  summaryVerification: ReportSummaryVerification
  summaryProvenance: ReportSummaryProvenance
  audit: HarnessAuditTrail
}

export type { PolicyDecision, PolicyResult, PrivacyReport }
