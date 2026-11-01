export const reportReadinessCodes = [
  "company_scope", "release_not_ready", "skill_binding", "agent_unavailable", "model_policy",
  "calibration", "decision_type", "budget_unavailable", "budget_exhausted", "model_price",
  "provider_unavailable", "readiness_unavailable", "authorization_denied",
] as const
export type ReportReadinessCode = typeof reportReadinessCodes[number]
export type ReportReadiness = { companyId: number; agentId: number; billableCalls: 0 } & (
  | { status: "ready"; code: null }
  | { status: "blocked"; code: ReportReadinessCode }
)
export function parseReportReadiness(value: unknown, companyId: number, agentId: number): ReportReadiness | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as { companyId?: unknown; agentId?: unknown; billableCalls?: unknown; status?: unknown; code?: unknown }
  if (row.companyId !== companyId || row.agentId !== agentId || row.billableCalls !== 0) return null
  if (Object.keys(row).some((key) => !["companyId", "agentId", "billableCalls", "status", "code"].includes(key))) return null
  if (row.status === "ready" && row.code === null) return row as ReportReadiness
  if (row.status === "blocked" && reportReadinessCodes.includes(row.code as ReportReadinessCode)) return row as ReportReadiness
  return null
}
export function parseReadinessIntent(value: unknown): { companyId: number; agentId: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as { companyId?: unknown; agentId?: unknown }
  if (Object.keys(row).some((key) => key !== "companyId" && key !== "agentId")) return null
  if (![row.companyId, row.agentId].every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return null
  return row as { companyId: number; agentId: number }
}
