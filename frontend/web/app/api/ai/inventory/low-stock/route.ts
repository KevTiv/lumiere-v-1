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
 * POST /api/ai/inventory/low-stock
 *
 * Protected BFF for the promoted `low_stock` green AI skill.
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

  const thresholdRaw = body.threshold
  const threshold =
    typeof thresholdRaw === "number"
      ? thresholdRaw
      : typeof thresholdRaw === "string"
        ? Number(thresholdRaw)
        : NaN
  if (!Number.isFinite(threshold) || threshold < 0) {
    return NextResponse.json(
      { error: "threshold must be a finite non-negative number" },
      { status: 400 },
    )
  }

  const locationId = positiveInteger(body.locationId ?? body.location_id)
  const orgPrivacyPolicy = resolveAiPrivacyPolicy(session.fieldAccess)

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  try {
    const gw = await fetchAiGateway("/v1/skills/inventory/low-stock", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId,
        company_id: companyId,
        threshold,
        location_id: locationId ?? null,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
        org_privacy_policy: orgPrivacyPolicy,
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
