/**
 * POST /api/ai/skills/sync — push bundled erp-skills/*.md definitions to SpacetimeDB.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const base = resolveAiGatewayBaseUrl()
  if (!base) {
    return NextResponse.json({ error: 'AI gateway is not configured' }, { status: 503 })
  }

  const { orgId, session } = contextResult.context
  try {
    const gw = await fetchAiGateway('/v1/skills/sync', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, stdb_token: session.stdbToken }),
    })
    const payload = gw.text ? JSON.parse(gw.text) : {}
    return NextResponse.json(payload, { status: gw.ok ? 200 : gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
