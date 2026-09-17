/**
 * GET /api/ai/runs — recent AI agent runs across all skills (AIH-9 Runs tab).
 *
 * Protected BFF proxying the ai-gateway `GET /v1/runs` endpoint. The org is
 * derived from the session server-side; a client-supplied org_id is never
 * forwarded.
 */
import { type NextRequest, NextResponse } from "next/server"

import { fetchAiGateway, resolveAiGatewayBaseUrl } from "@/lib/ai-gateway-server"
import {
  boundedInteger,
  optionalPositiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from "../_lib/route-helpers"

const RUN_STATUS_ALLOWLIST = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
  "agent_settled",
] as const

/** undefined = filter absent, NaN = supplied but invalid. */
function optionalIdFilter(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name)
  if (raw === null || raw === "") return undefined
  return optionalPositiveInteger(raw)
}

export async function GET(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const { session, orgId } = contextResult.context
  const params = request.nextUrl.searchParams

  // Company scope is optional; when supplied it must belong to the session org.
  const companyIdRaw = params.get("companyId")
  let companyId: number | undefined
  if (companyIdRaw !== null && companyIdRaw !== "") {
    const parsed = optionalPositiveInteger(companyIdRaw)
    if (parsed === undefined || !Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: "companyId must be a positive integer" },
        { status: 400 },
      )
    }
    const companyError = await validateCompanyScope(session, parsed)
    if (companyError) return companyError
    companyId = parsed
  }

  const skillId = optionalIdFilter(params, "skillId")
  if (skillId !== undefined && !Number.isFinite(skillId)) {
    return NextResponse.json(
      { error: "skillId must be a positive integer" },
      { status: 400 },
    )
  }

  const agentId = optionalIdFilter(params, "agentId")
  if (agentId !== undefined && !Number.isFinite(agentId)) {
    return NextResponse.json(
      { error: "agentId must be a positive integer" },
      { status: 400 },
    )
  }

  const status = params.get("status")
  if (
    status !== null &&
    status !== "" &&
    !RUN_STATUS_ALLOWLIST.includes(status as (typeof RUN_STATUS_ALLOWLIST)[number])
  ) {
    return NextResponse.json(
      { error: `status must be one of: ${RUN_STATUS_ALLOWLIST.join(", ")}` },
      { status: 400 },
    )
  }

  const days = boundedInteger(params.get("days"), 7, 1, 90)
  const limit = boundedInteger(params.get("limit"), 50, 1, 200)

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  const gatewayParams = new URLSearchParams({ org_id: String(orgId) })
  if (companyId !== undefined) gatewayParams.set("company_id", String(companyId))
  if (skillId !== undefined) gatewayParams.set("skill_id", String(skillId))
  if (agentId !== undefined) gatewayParams.set("agent_id", String(agentId))
  if (status !== null && status !== "") gatewayParams.set("status", status)
  gatewayParams.set("days", String(days))
  gatewayParams.set("limit", String(limit))

  try {
    const gw = await fetchAiGateway(`/v1/runs?${gatewayParams.toString()}`, {
      method: "GET",
    })
    const payload = gw.text
      ? (() => {
        try {
          return JSON.parse(gw.text) as unknown
        } catch {
          return { error: gw.text }
        }
      })()
      : {}
    return NextResponse.json(payload, { status: gw.status })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: "AI gateway request failed", detail },
      { status: 502 },
    )
  }
}
