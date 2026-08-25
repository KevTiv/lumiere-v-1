/**
 * POST /api/ai/rag — retrieval-augmented answers scoped to an ERP company the user can access.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'
import { fetchAiGateway } from '@/lib/ai-gateway-server'
import { companyIdBelongsToOrganization } from '@/lib/company-scope-server'
import { requireAiRouteContext } from '../_lib/route-helpers'

interface Body {
  query?: unknown
  company_id?: unknown
  companyId?: unknown
  include_types?: unknown
  limit?: unknown
  ui_context?: unknown
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
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { session, orgId } = contextResult.context

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

  const include_types = sanitizeIncludeTypes(body.include_types)

  const ui_context = sanitizeRagUiContext(body.ui_context)

  const gwPayload: Record<string, unknown> = {
    company_id: companyIdNum,
    org_id: orgId,
    query,
    limit,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
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
    return NextResponse.json(payload, { status: gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
