import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export type C9EvidenceCheck = {
  id: string
  status: "pass" | "not_run"
  after_reconstruction: boolean
  evidence: string
}

export type C9BrowserEvidence = {
  schema_version: 1
  generated_at: string
  source: "crm-read-isolation.spec.ts"
  phase: "post-reconstruction"
  post_reconstruction: true
  fixtures: {
    org_a: number
    org_b: number
    company_a1: number
    company_a2: number
    company_a1_org: number
    company_a2_org: number
  }
  audit: {
    server_derived: true
    actor_identity: string
    correlation_id: string
  }
  lanes: {
    commands: { fresh_session: false; checks: C9EvidenceCheck[] }
    reads: { fresh_session: false; checks: C9EvidenceCheck[] }
    subscriptions: { fresh_session: false; checks: C9EvidenceCheck[] }
    fresh_sessions: { fresh_session: true; checks: C9EvidenceCheck[] }
  }
}

/**
 * Persist optional browser evidence only when the caller explicitly marks the
 * target as reconstructed. The test calls this after every assertion, so a
 * failed assertion cannot produce a passing artifact.
 */
export function writeC9BrowserEvidence(report: C9BrowserEvidence): string | undefined {
  const outputPath = process.env.C9_BROWSER_EVIDENCE_PATH?.trim()
  if (!outputPath) return undefined
  if (process.env.C9_POST_RECONSTRUCTION !== "1") {
    throw new Error(
      "C9_BROWSER_EVIDENCE_PATH requires C9_POST_RECONSTRUCTION=1; refusing to claim live evidence before reconstruction",
    )
  }
  if (report.phase !== "post-reconstruction" || report.post_reconstruction !== true) {
    throw new Error("C9 browser evidence must be marked post-reconstruction")
  }
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return outputPath
}
