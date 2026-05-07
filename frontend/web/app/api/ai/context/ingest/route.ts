/**
 * POST /api/ai/context/ingest — manually trigger ERP activity ingestion for this organization.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { resolveApiSession } from '@/lib/api-session'

export async function POST(_request: NextRequest) {
  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      {
        error:
          'AI gateway is not configured for this deployment. Set LUMIERE_AI_GATEWAY_URL (server-side).',
      },
      { status: 503 },
    )
  }

  const session = await resolveApiSession(_request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgId = session.organizationId
  if (orgId === undefined || orgId <= 0) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 })
  }

  try {
    const gw = await fetchAiGateway('/v1/context/ingest', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId }),
    })
    const payload = gw.text ? JSON.parse(gw.text) : {}
    return NextResponse.json(payload, { status: gw.ok ? 200 : gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
