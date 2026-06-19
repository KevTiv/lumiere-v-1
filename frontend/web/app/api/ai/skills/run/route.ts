/**
 * POST /api/ai/skills/run — execute a configured AI skill.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  optionalPositiveInteger,
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
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

  const companyId = optionalPositiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const skillKey =
    typeof body.skillKey === 'string'
      ? body.skillKey.trim()
      : typeof body.skill_key === 'string'
        ? body.skill_key.trim()
        : ''
  if (!skillKey) {
    return NextResponse.json({ error: 'skillKey is required' }, { status: 400 })
  }

  const inputs = sanitizeRecord(body.inputs) ?? {}
  const agentId = optionalPositiveInteger(body.agentId ?? body.agent_id)
  const teamMemberId = optionalPositiveInteger(body.teamMemberId ?? body.team_member_id)
  const overrides = sanitizeRecord(body.overrides)

  if (agentId != null && !Number.isFinite(agentId)) {
    return NextResponse.json({ error: 'agentId must be a positive integer' }, { status: 400 })
  }
  if (teamMemberId != null && !Number.isFinite(teamMemberId)) {
    return NextResponse.json({ error: 'teamMemberId must be a positive integer' }, { status: 400 })
  }

  return proxyAiGateway('/v1/skills/run', {
    org_id: orgId,
    company_id: companyId,
    skill_key: skillKey,
    inputs,
    stdb_token: session.stdbToken,
    triggered_by_hex: session.identityHex,
    ...(agentId != null ? { agent_id: agentId } : {}),
    ...(teamMemberId != null ? { team_member_id: teamMemberId } : {}),
    ...(overrides ? { overrides } : {}),
  })
}
