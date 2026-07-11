/**
 * POST /api/ai/report/compose — run the promoted green report-composer skill.
 *
 * The BFF resolves the caller's organization-level AI privacy policy from Casbin
 * rules and forwards it to the gateway, where it is merged with the skill
 * manifest's privacy policy before `PrivacyGuard` is applied.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import {
  optionalPositiveInteger,
  parseJsonBody,
  requireAiRouteContext,
  sanitizeIdentifier,
  validateCompanyScope,
} from '../../_lib/route-helpers'
import { resolveAiPrivacyPolicy } from '../../_lib/ai-privacy-policy'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = optionalPositiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const reportKey = sanitizeIdentifier(body.reportKey ?? body.report_key ?? '', 120)
  if (!reportKey) {
    return NextResponse.json({ error: 'reportKey is required' }, { status: 400 })
  }

  const date = sanitizeIdentifier(body.date ?? '', 120)
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  const timezone = sanitizeIdentifier(body.timezone ?? '', 120)
  if (!timezone) {
    return NextResponse.json({ error: 'timezone is required' }, { status: 400 })
  }

  const orgPrivacyPolicy = resolveAiPrivacyPolicy(session.fieldAccess)

  const base = resolveAiGatewayBaseUrl()
  if (!base) {
    return NextResponse.json({ error: 'AI gateway is not configured' }, { status: 503 })
  }

  try {
    const gw = await fetchAiGateway('/v1/skills/report/compose', {
      method: 'POST',
      body: JSON.stringify({
        org_id: orgId,
        company_id: companyId,
        report_key: reportKey,
        date,
        timezone,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
        org_privacy_policy: orgPrivacyPolicy,
      }),
    })

    const responsePayload = gw.text
      ? (() => {
        try {
          return JSON.parse(gw.text) as Record<string, unknown>
        } catch {
          return { error: gw.text }
        }
      })()
      : {}
    return NextResponse.json(responsePayload, { status: gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
