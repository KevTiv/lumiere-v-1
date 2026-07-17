import { type NextRequest, NextResponse } from "next/server"

import { fetchAiGateway, resolveAiGatewayBaseUrl } from "@/lib/ai-gateway-server"
import {
  boundedNumber,
  parseJsonBody,
  positiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from "../../_lib/route-helpers"
import { resolveAiPrivacyPolicy } from "../../_lib/ai-privacy-policy"

/** Protected BFF for the promoted, read-only credit exposure control. */
export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const companyId = positiveInteger(bodyResult.body.companyId ?? bodyResult.body.company_id)
  const companyError = await validateCompanyScope(session, companyId)
  if (companyError) return companyError
  const minimumOutstanding = boundedNumber(
    bodyResult.body.minimumOutstanding ?? bodyResult.body.minimum_outstanding,
    0.01,
    0,
    1_000_000_000,
  )

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json({ error: "AI gateway is not configured" }, { status: 503 })
  }

  const gateway = await fetchAiGateway("/v1/skills/distributor/credit-hold-summary", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      company_id: companyId,
      minimum_outstanding: minimumOutstanding,
      stdb_token: session.stdbToken,
      identity_hex: session.identityHex,
      org_privacy_policy: resolveAiPrivacyPolicy(session.fieldAccess),
    }),
  })
  const payload = gateway.text ? safeJson(gateway.text) : {}
  return NextResponse.json(payload, { status: gateway.status })
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { error: value }
  }
}
