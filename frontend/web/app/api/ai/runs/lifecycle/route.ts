import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { fetchAiGateway } from '@/lib/ai-gateway-server'
import {
  parseJsonBody,
  requireAiRouteContext,
  validateCompanyScope,
} from '../../_lib/route-helpers'
import { buildGatewayLifecycleRequest, parseLifecycleBrowserBody } from './contract'

const NO_STORE = { 'Cache-Control': 'no-store' }

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Session-owned adapter; browser input contains company intent only. */
export async function POST(request: NextRequest) {
  const context = await requireAiRouteContext(request)
  if (!context.ok) return noStore(context.response)
  const body = await parseJsonBody(request)
  if (!body.ok) return noStore(body.response)
  const parsed = parseLifecycleBrowserBody(body.body)
  if (!parsed) return NextResponse.json({ error: 'Invalid lifecycle request' }, { status: 400, headers: NO_STORE })

  const { session, orgId } = context.context
  if (!session.identityHex || session.identityHex === 'unknown' || !session.stdbToken.trim()) {
    return NextResponse.json({ error: 'Authenticated actor context required' }, { status: 403, headers: NO_STORE })
  }
  const companyError = await validateCompanyScope(session, parsed.companyId)
  if (companyError) return noStore(companyError)
  if (!process.env.LUMIERE_AI_GATEWAY_INTERNAL_SECRET?.trim()) {
    return NextResponse.json({ error: 'Lifecycle service unavailable' }, { status: 503, headers: NO_STORE })
  }

  try {
    const gatewayRequest = buildGatewayLifecycleRequest(parsed, {
      organizationId: orgId,
      actorIdentity: session.identityHex,
      stdbToken: session.stdbToken,
    })
    const response = await fetchAiGateway('/v1/internal/harness/runs/lifecycle', {
      method: 'POST',
      headers: gatewayRequest.headers,
      body: JSON.stringify(gatewayRequest.body),
    })
    if (!response.ok) {
      const status = [400, 403, 404, 409, 422].includes(response.status) ? response.status : 503
      return NextResponse.json(
        { error: status === 403 ? 'Lifecycle operation is not permitted' : status === 404 ? 'Run not found' : 'Lifecycle operation failed' },
        { status, headers: NO_STORE },
      )
    }
    const payload = response.text ? JSON.parse(response.text) as unknown : {}
    return NextResponse.json(payload, { status: 200, headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Lifecycle service unavailable' }, { status: 503, headers: NO_STORE })
  }
}
