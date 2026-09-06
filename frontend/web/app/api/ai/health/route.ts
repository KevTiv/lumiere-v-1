/**
 * GET /api/ai/health — proxies ai-gateway readiness for ERP Settings diagnostics.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { resolveApiSession } from '@/lib/api-session'

export async function GET(request: NextRequest) {
  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json({
      configured: false,
      message: 'LUMIERE_AI_GATEWAY_URL is not set.',
    })
  }

  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const gw = await fetchAiGateway('/health/ready', { method: 'GET' })
    let payload: unknown = gw.text
    try {
      payload = gw.text ? JSON.parse(gw.text) : {}
    } catch {
      payload = { raw: gw.text }
    }
    return NextResponse.json(
      { configured: true, upstreamStatus: gw.status, upstreamOk: gw.ok, gateway: payload },
      { status: gw.ok ? 200 : gw.status >= 400 ? gw.status : 502 },
    )
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      { configured: true, reachable: false, detail },
      { status: 502 },
    )
  }
}
