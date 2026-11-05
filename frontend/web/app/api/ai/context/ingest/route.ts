/** POST /api/ai/context/ingest — project explicit currently authorized ERP references. */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway } from '@/lib/ai-gateway-server'
import { requireAiRouteContext, validateCompanyScope } from '../../_lib/route-helpers'
import { parseActivityIngestBody, type ActivityIngestBody } from './body'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { orgId, session } = contextResult.context

  let body: ActivityIngestBody
  try {
    body = parseActivityIngestBody(await request.json())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status: 400 })
  }
  const companyError = await validateCompanyScope(session, body.companyId)
  if (companyError) return companyError

  try {
    const gateway = await fetchAiGateway('/v1/context/ingest', {
      method: 'POST',
      body: JSON.stringify({
        org_id: orgId,
        company_id: body.companyId,
        resources: body.resources,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
      }),
    })
    const payload: unknown = gateway.text ? JSON.parse(gateway.text) : {}
    return NextResponse.json(payload, { status: gateway.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Activity indexing gateway unavailable' }, { status: 502 })
  }
}
