/**
 * POST /api/ai/actions/draft — draft reducer calls from natural language.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'

import {
  boundedString,
  optionalPositiveInteger,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeStringList,
  validateCompanyScope,
} from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = optionalPositiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const query = boundedString(body.query, 2_000)
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  const uiContext = sanitizeRagUiContext(body.uiContext ?? body.ui_context)
  const allowedReducers = sanitizeStringList(body.allowedReducers ?? body.allowed_reducers, 50, 120)
  const agentId = optionalPositiveInteger(body.agentId ?? body.agent_id)
  const teamMemberId = optionalPositiveInteger(body.teamMemberId ?? body.team_member_id)

  return proxyAiGateway('/v1/actions/draft', {
    org_id: orgId,
    company_id: companyId,
    query,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
    ...(uiContext ? { ui_context: uiContext } : {}),
    ...(allowedReducers?.length ? { allowed_reducers: allowedReducers } : {}),
    ...(agentId != null ? { agent_id: agentId } : {}),
    ...(teamMemberId != null ? { team_member_id: teamMemberId } : {}),
  })
}
