/**
 * POST /api/ai/rag — retrieval-augmented answers scoped to an ERP company the user can access.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'
import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { companyIdBelongsToOrganization } from '@/lib/company-scope-server'
import { resolveApiSession } from '@/lib/api-session'

interface Body {
  query?: unknown
  company_id?: unknown
  companyId?: unknown
  include_types?: unknown
  limit?: unknown
  ui_context?: unknown
}

export async function POST(request: NextRequest) {
  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      {
        error:
          'AI gateway is not configured for this deployment. Set LUMIERE_AI_GATEWAY_URL (server-side).',
      },
      { status: 503 },
    )
  }

  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgId = session.organizationId
  if (orgId === undefined || orgId <= 0) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const rawCompany = body.companyId ?? body.company_id
  const companyIdNum =
    typeof rawCompany === 'number'
      ? rawCompany
      : typeof rawCompany === 'string' && rawCompany.trim() !== ''
        ? Number.parseInt(rawCompany, 10)
        : NaN

  if (!Number.isFinite(companyIdNum) || companyIdNum <= 0) {
    return NextResponse.json({ error: 'companyId must be a positive integer' }, { status: 400 })
  }

  const allowed = await companyIdBelongsToOrganization(session, companyIdNum)
  if (!allowed) {
    return NextResponse.json({ error: 'Company does not belong to this organization' }, { status: 403 })
  }

  let limit = 20
  const rawLimit = body.limit
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) limit = Math.floor(rawLimit)
  if (typeof rawLimit === 'string' && rawLimit.trim() !== '') {
    const n = Number.parseInt(rawLimit, 10)
    if (Number.isFinite(n)) limit = n
  }
  limit = Math.min(40, Math.max(1, limit))

  const include_types = Array.isArray(body.include_types)
    ? body.include_types.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : undefined

  const ui_context = sanitizeRagUiContext(body.ui_context)

  const gwPayload: Record<string, unknown> = {
    company_id: companyIdNum,
    org_id: orgId,
    query,
    limit,
  }
  if (include_types?.length) gwPayload.include_types = include_types
  if (ui_context) gwPayload.ui_context = ui_context

  const gwBody = JSON.stringify(gwPayload)

  try {
    const gw = await fetchAiGateway('/v1/rag', {
      method: 'POST',
      body: gwBody,
    })
    const payload = gw.text ? JSON.parse(gw.text) : {}
    return NextResponse.json(payload, { status: gw.ok ? 200 : gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
