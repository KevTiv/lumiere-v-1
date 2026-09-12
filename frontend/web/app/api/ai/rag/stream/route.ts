/**
 * POST /api/ai/rag/stream — validated SSE proxy to ai-gateway RAG streaming.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'

import {
  optionalPositiveInteger,
  parseJsonBody,
  requireAiRouteContext,
} from '../../_lib/route-helpers'
import { prepareRagPayload } from '../../_lib/rag-request'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { session, orgId } = contextResult.context
  const gatewayBase = resolveAiGatewayBaseUrl()!

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response
  const body = bodyResult.body

  const ragResult = await prepareRagPayload({ body, session, orgId })
  if (!ragResult.ok) return ragResult.response

  const gwPayload: Record<string, unknown> = { ...ragResult.payload }

  // Stream-only fields — not in the non-streaming RAG route.
  const agentId = optionalPositiveInteger(body.agent_id)
  if (agentId !== undefined && !Number.isNaN(agentId)) gwPayload.agent_id = agentId
  const teamMemberId = optionalPositiveInteger(body.team_member_id)
  if (teamMemberId !== undefined && !Number.isNaN(teamMemberId)) {
    gwPayload.team_member_id = teamMemberId
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  const secret = process.env['LUMIERE_AI_GATEWAY_INTERNAL_SECRET']
  if (secret) headers.set('X-Lumiere-Gateway-Secret', secret)

  const gw = await fetch(`${gatewayBase}/v1/rag/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(gwPayload),
    cache: 'no-store',
  })

  if (!gw.ok || !gw.body) {
    let errorPayload: Record<string, unknown> = { error: 'AI gateway stream request failed' }
    const text = await gw.text().catch(() => '')
    if (text) {
      try {
        errorPayload = JSON.parse(text) as Record<string, unknown>
      } catch {
        errorPayload = { error: 'AI gateway stream request failed', detail: text }
      }
    }
    return NextResponse.json(errorPayload, { status: gw.status || 502 })
  }

  return new Response(gw.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
