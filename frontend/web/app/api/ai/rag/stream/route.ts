/**
 * POST /api/ai/rag/stream — validated SSE proxy to ai-gateway RAG streaming.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'
import { resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { companyIdBelongsToOrganization } from '@/lib/company-scope-server'
import { resolveApiSession } from '@/lib/api-session'

interface Body {
  query?: unknown
  company_id?: unknown
  companyId?: unknown
  include_types?: unknown
  limit?: unknown
  ui_context?: unknown
  agent_id?: unknown
  team_member_id?: unknown
}

const MAX_INCLUDE_TYPES = 8

function sanitizeIncludeTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const seen = new Set<string>()
  const out: string[] = []

  for (const value of raw) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase().replaceAll('-', '_')
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= MAX_INCLUDE_TYPES) break
  }

  return out.length > 0 ? out : undefined
}

export async function POST(request: NextRequest) {
  const gatewayBase = resolveAiGatewayBaseUrl()
  if (!gatewayBase) {
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

  const gwPayload: Record<string, unknown> = {
    company_id: companyIdNum,
    org_id: orgId,
    query,
    limit,
  }
  const includeTypes = sanitizeIncludeTypes(body.include_types)
  const uiContext = sanitizeRagUiContext(body.ui_context)
  if (includeTypes?.length) gwPayload.include_types = includeTypes
  if (uiContext) gwPayload.ui_context = uiContext

  const agentIdRaw = body.agent_id
  const teamMemberIdRaw = body.team_member_id
  const agentId =
    typeof agentIdRaw === 'number'
      ? agentIdRaw
      : typeof agentIdRaw === 'string' && agentIdRaw.trim() !== ''
        ? Number.parseInt(agentIdRaw, 10)
        : NaN
  const teamMemberId =
    typeof teamMemberIdRaw === 'number'
      ? teamMemberIdRaw
      : typeof teamMemberIdRaw === 'string' && teamMemberIdRaw.trim() !== ''
        ? Number.parseInt(teamMemberIdRaw, 10)
        : NaN
  if (Number.isFinite(agentId) && agentId > 0) gwPayload.agent_id = agentId
  if (Number.isFinite(teamMemberId) && teamMemberId > 0) {
    gwPayload.team_member_id = teamMemberId
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  const secret = process.env['LUMIERE_AI_GATEWAY_INTERNAL_SECRET']
  if (secret) headers.set('X-Lumiere-Gateway-Secret', secret)

  const gw = await fetch(`${gatewayBase}/v1/rag/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(gwPayload),
    cache: 'no-store',
  })

  if (!gw.ok || !gw.body) {
    const text = await gw.text().catch(() => '')
    return NextResponse.json(
      { error: 'AI gateway stream request failed', detail: text },
      { status: gw.status || 502 },
    )
  }

  return new Response(gw.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
