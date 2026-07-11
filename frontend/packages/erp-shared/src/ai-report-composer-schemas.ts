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

export interface ReportComposerResult {
  decision: PolicyResult
  summary: string
  citations: ReportCitation[]
  audit: HarnessAuditTrail
}

export type { PolicyDecision, PolicyResult, PrivacyReport }
