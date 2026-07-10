import { type NextRequest, NextResponse } from "next/server"

import {
  fetchAiGateway,
  resolveAiGatewayBaseUrl,
} from "@/lib/ai-gateway-server"
import {
  boundedString,
  parseJsonBody,
  positiveInteger,
  requireAiRouteContext,
  sanitizeIdentifier,
  validateCompanyScope,
} from "../../_lib/route-helpers"

/**
 * POST /api/ai/report/compose
 *
 * Protected BFF for the promoted `report_composer` green AI skill. Organization
 * and actor context are derived from the session; only company, report key,
 * date, and timezone come from the browser.
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

  const reportKey = sanitizeIdentifier(body.reportKey ?? body.report_key ?? "", 120)
  const date = boundedString(body.date, 10)
  const timezone = boundedString(body.timezone, 64)

  if (!reportKey) {
    return NextResponse.json({ error: "reportKey is required" }, { status: 400 })
  }
  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 })
  }
  if (!timezone) {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 })
  }

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  try {
    const gw = await fetchAiGateway("/v1/skills/report/compose", {
      method: "POST",
      body: JSON.stringify({
        orgId,
        companyId,
        reportKey,
        date,
        timezone,
        stdbToken: session.stdbToken,
        identityHex: session.identityHex,
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
