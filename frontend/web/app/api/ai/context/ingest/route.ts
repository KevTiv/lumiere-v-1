/**
 * POST /api/ai/context/ingest — manually trigger ERP activity ingestion for this organization.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway } from '@/lib/ai-gateway-server'
import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { orgId } = contextResult.context

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
