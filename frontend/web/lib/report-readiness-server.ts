import "server-only"
import { fetchAiGateway } from "./ai-gateway-server"
import { parseReportReadiness, type ReportReadiness } from "./report-readiness"

export async function readReportReadiness(scope: {
  organizationId: number; companyId: number; agentId: number; actorIdentity: string; stdbToken: string
}): Promise<ReportReadiness> {
  const { organizationId, companyId, agentId, actorIdentity, stdbToken } = scope
  const blocked = (code: "readiness_unavailable" | "authorization_denied"): ReportReadiness =>
    ({ companyId, agentId, status: "blocked", code, billableCalls: 0 })
  try {
    const response = await fetchAiGateway("/v1/internal/harness/report-readiness", {
      method: "POST", body: JSON.stringify({ orgId: organizationId, companyId, agentId }),
      headers: { "x-lumiere-organization-id": String(organizationId), "x-lumiere-company-id": String(companyId),
        "x-lumiere-actor-identity": actorIdentity, "x-lumiere-actor-token": stdbToken },
    })
    if (response.status === 403) return blocked("authorization_denied")
    if (!response.ok) return blocked("readiness_unavailable")
    return parseReportReadiness(JSON.parse(response.text), companyId, agentId) ?? blocked("readiness_unavailable")
  } catch { return blocked("readiness_unavailable") }
}
