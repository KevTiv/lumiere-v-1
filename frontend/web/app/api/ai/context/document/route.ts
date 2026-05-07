/**
 * POST /api/ai/context/document — ingest document text/image bytes into AI memory (+ STDB doc job via gateway).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { resolveApiSession } from '@/lib/api-session'

interface Body {
  doc_id?: unknown
  doc_type?: unknown
  filename?: unknown
  content?: unknown
  mime_type?: unknown
  uploaded_by?: unknown
}

export async function POST(request: NextRequest) {
  if (!resolveAiGatewayBaseUrl()) {
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

  const doc_id = typeof body.doc_id === 'string' ? body.doc_id.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!doc_id || !content.trim()) {
    return NextResponse.json({ error: 'doc_id and non-empty content are required' }, { status: 400 })
  }

  const gwBody = JSON.stringify({
    org_id: orgId,
    doc_id,
    doc_type:
      typeof body.doc_type === 'string' && body.doc_type.trim() !== ''
        ? body.doc_type.trim()
        : undefined,
    filename:
      typeof body.filename === 'string' && body.filename.trim() !== ''
        ? body.filename.trim()
        : undefined,
    content,
    mime_type:
      typeof body.mime_type === 'string' && body.mime_type.trim() !== ''
        ? body.mime_type.trim()
        : undefined,
    uploaded_by:
      typeof body.uploaded_by === 'string' && body.uploaded_by.trim() !== ''
        ? body.uploaded_by.trim()
        : session.identityHex !== 'unknown'
          ? session.identityHex.slice(0, 16)
          : undefined,
  })

  try {
    const gw = await fetchAiGateway('/v1/context/document', {
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
