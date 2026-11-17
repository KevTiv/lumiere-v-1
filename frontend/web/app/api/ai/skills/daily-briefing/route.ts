import { type NextRequest, NextResponse } from "next/server"

import {
  fetchAiGateway,
  resolveAiGatewayBaseUrl,
} from "@/lib/ai-gateway-server"
import {
  parseJsonBody,
  positiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from "../../_lib/route-helpers"
import { resolveAiPrivacyPolicy } from "../../_lib/ai-privacy-policy"

/**
 * POST /api/ai/skills/daily-briefing
 */
export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  try {
    const gw = await fetchAiGateway("/v1/skills/daily-briefing", {
      method: "POST",
      body: JSON.stringify({
        orgId,
        companyId,
        sinceMicros: body.sinceMicros ?? body.since_micros ?? null,
        untilMicros: body.untilMicros ?? body.until_micros ?? null,
        allowedModules: body.allowedModules ?? body.allowed_modules ?? [],
        activityQuery: body.activityQuery ?? body.activity_query ?? null,
        topK: body.topK ?? body.top_k ?? null,
        stdbToken: session.stdbToken,
        identityHex: session.identityHex,
        orgPrivacyPolicy: resolveAiPrivacyPolicy(session.fieldAccess),
      }),
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
