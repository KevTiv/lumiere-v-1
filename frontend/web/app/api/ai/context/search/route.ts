/**
 * POST /api/ai/context/search — semantic search over org ERP activity memory (Qdrant via ai-gateway).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { resolveApiSession } from '@/lib/api-session'

interface Body {
  query?: unknown
  top_k?: unknown
}

export async function POST(request: NextRequest) {
  const baseError = NextResponse.json(
    {
      error:
        'AI gateway is not configured for this deployment. Set LUMIERE_AI_GATEWAY_URL (server-side).',
    },
    { status: 503 },
  )

  if (!resolveAiGatewayBaseUrl()) return baseError

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

  const rawTop = body.top_k
  let top_k = typeof rawTop === 'number' && Number.isFinite(rawTop) ? Math.floor(rawTop) : 8
  if (typeof rawTop === 'string' && rawTop.trim() !== '') {
    const n = Number.parseInt(rawTop, 10)
    if (Number.isFinite(n)) top_k = n
  }
  top_k = Math.min(50, Math.max(1, top_k))

  const gwBody = JSON.stringify({
    org_id: orgId,
    query,
    top_k,
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
