/**
 * GET /api/ai/runs/[runId]/steps — live run transcript (AIH-7/AIH-8).
 *
 * Protected BFF proxying the ai-gateway `GET /v1/runs/{runId}/steps`
 * endpoint. `companyId` is required and must belong to the session org; the
 * org itself is derived from the session server-side.
 */
import { type NextRequest, NextResponse } from "next/server"

import { fetchAiGateway, resolveAiGatewayBaseUrl } from "@/lib/ai-gateway-server"
import {
  positiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from "../../../_lib/route-helpers"

export async function GET(
  request: NextRequest,
  route: { params: Promise<{ runId: string }> },
) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const { runId } = await route.params
  const parsedRunId = positiveInteger(runId)
  if (!Number.isFinite(parsedRunId)) {
    return NextResponse.json(
      { error: "runId must be a positive integer" },
      { status: 400 },
    )
  }

  const companyId = positiveInteger(request.nextUrl.searchParams.get("companyId"))
  if (!Number.isFinite(companyId)) {
    return NextResponse.json(
      { error: "companyId is required and must be a positive integer" },
      { status: 400 },
    )
  }

  const companyError = await validateCompanyScope(
    contextResult.context.session,
    companyId,
  )
  if (companyError) return companyError

  const { orgId } = contextResult.context

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  const gatewayParams = new URLSearchParams({
    org_id: String(orgId),
    company_id: String(companyId),
  })

  try {
    const gw = await fetchAiGateway(
      `/v1/runs/${parsedRunId}/steps?${gatewayParams.toString()}`,
      { method: "GET" },
    )
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
