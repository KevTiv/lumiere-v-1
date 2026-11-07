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
        orgId,
        companyId,
        targetEntity,
        csvText: body.csvText ?? body.csv_text ?? null,
        csvDelimiter: body.csvDelimiter ?? body.csv_delimiter ?? null,
        headers: body.headers ?? null,
        sampleRows: body.sampleRows ?? body.sample_rows ?? null,
        mapping: body.mapping ?? null,
        priorMappings: body.priorMappings ?? body.prior_mappings ?? null,
        bundleKey: body.bundleKey ?? body.bundle_key ?? null,
        maxRows: body.maxRows ?? body.max_rows ?? null,
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
