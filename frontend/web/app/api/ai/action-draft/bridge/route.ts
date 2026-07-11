/**
 * POST /api/ai/action-draft/bridge
 *
 * BFF for the harness red-action bridge. Resolves the caller's session, forwards
 * a policy-controlled request to the AI gateway, and returns the policy decision
 * plus the persisted draft id when the gateway created one.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import {
  parseJsonBody,
  positiveInteger,
  requireAiRouteContext,
  sanitizeRecord,
  validateCompanyScope,
} from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const execution = sanitizeRecord(body.execution)
  if (!execution) {
    return NextResponse.json({ error: 'execution is required' }, { status: 400 })
  }

  const companyId = positiveInteger(execution.company_id ?? execution.companyId)
  const companyError = await validateCompanyScope(session, companyId)
  if (companyError) return companyError

  // Scope and actor identity come from the authenticated server session, never
  // from the browser's proposed execution payload.
  const metadata = sanitizeRecord(execution.metadata) ?? {}
  const scopedExecution = {
    ...execution,
    organization_id: orgId,
    company_id: companyId,
    metadata: {
      ...metadata,
      actor_id: session.identityHex,
    },
  }
  const candidateOutput = sanitizeRecord(body.candidateOutput ?? body.candidate_output)

  const base = resolveAiGatewayBaseUrl()
  if (!base) {
    return NextResponse.json({ error: 'AI gateway is not configured' }, { status: 503 })
  }

  try {
    const gw = await fetchAiGateway('/v1/actions/bridge', {
      method: 'POST',
      body: JSON.stringify({
        execution: scopedExecution,
        candidate_output: candidateOutput ?? null,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
      }),
    })

    const responsePayload = gw.text
      ? (() => {
        try {
          return JSON.parse(gw.text) as Record<string, unknown>
        } catch {
          return { error: gw.text }
        }
      })()
      : {}
    return NextResponse.json(responsePayload, { status: gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
