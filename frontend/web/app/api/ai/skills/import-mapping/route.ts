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
 * POST /api/ai/skills/import-mapping
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

  const targetEntity =
    typeof body.targetEntity === "string"
      ? body.targetEntity.trim()
      : typeof body.target_entity === "string"
        ? body.target_entity.trim()
        : ""
  if (!targetEntity) {
    return NextResponse.json(
      { error: "targetEntity is required" },
      { status: 400 },
    )
  }

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  try {
    const gw = await fetchAiGateway("/v1/skills/import-mapping", {
      method: "POST",
      body: JSON.stringify({
        org_id: orgId,
        company_id: companyId,
        target_entity: targetEntity,
        csv_text: body.csvText ?? body.csv_text ?? null,
        headers: body.headers ?? null,
        sample_rows: body.sampleRows ?? body.sample_rows ?? null,
        mapping: body.mapping ?? null,
        prior_mappings: body.priorMappings ?? body.prior_mappings ?? null,
        bundle_key: body.bundleKey ?? body.bundle_key ?? null,
        max_rows: body.maxRows ?? body.max_rows ?? null,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
        org_privacy_policy: resolveAiPrivacyPolicy(session.fieldAccess),
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
