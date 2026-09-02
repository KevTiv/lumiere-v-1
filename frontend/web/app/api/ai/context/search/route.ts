/**
 * POST /api/ai/context/search — semantic search over org ERP activity memory (Qdrant via ai-gateway).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway } from '@/lib/ai-gateway-server'
import {
  positiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from '../../_lib/route-helpers'

interface Body {
  query?: unknown
  top_k?: unknown
  companyId?: unknown
  company_id?: unknown
}

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { orgId, session } = contextResult.context

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

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId)
  if (companyError) return companyError

  const rawTop = body.top_k
  let top_k = typeof rawTop === 'number' && Number.isFinite(rawTop) ? Math.floor(rawTop) : 8
  if (typeof rawTop === 'string' && rawTop.trim() !== '') {
    const n = Number.parseInt(rawTop, 10)
    if (Number.isFinite(n)) top_k = n
  }
  top_k = Math.min(50, Math.max(1, top_k))

  const gwBody = JSON.stringify({
    org_id: orgId,
    company_id: companyId,
    query,
    top_k,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
  })

  try {
    const gw = await fetchAiGateway('/v1/context/search', {
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
