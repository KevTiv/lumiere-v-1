/**
 * GET/PATCH /api/ai/skills/config — read or update tenant skill configuration.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { callReducer } from '@/lib/stdb-reducer'
import {
  requireAiRouteContext,
  parseJsonBody,
  optionalPositiveInteger,
  validateCompanyScope,
} from '../../_lib/route-helpers'

export async function PATCH(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = optionalPositiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const skillId = optionalPositiveInteger(body.skillId ?? body.skill_id)
  if (skillId == null || !Number.isFinite(skillId) || skillId <= 0) {
    return NextResponse.json({ error: 'skillId is required' }, { status: 400 })
  }

  const configJson =
    typeof body.configJson === 'string'
      ? body.configJson
      : typeof body.config_json === 'string'
        ? body.config_json
        : JSON.stringify(body.configJson ?? body.config_json ?? {})

  const isEnabled = body.isEnabled ?? body.is_enabled
  const customInstructions =
    typeof body.customInstructions === 'string'
      ? body.customInstructions
      : typeof body.custom_instructions === 'string'
        ? body.custom_instructions
        : undefined

  try {
    await callReducer(
      'upsert_ai_skill_config',
      [
        orgId,
        {
          company_id: companyId ?? null,
          skill_id: skillId,
          is_enabled: isEnabled !== false,
          config_json: configJson,
          custom_instructions: customInstructions ?? null,
          tool_overrides: [],
          metadata: null,
        },
      ],
      { token: session.stdbToken },
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'Failed to update skill config', detail }, { status: 502 })
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use SpacetimeDB subscriptions for ai_skill_config in Phase A' },
    { status: 501 },
  )
}
