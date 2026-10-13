/**
 * POST /api/ai/skills/run — retired compatibility boundary.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  optionalPositiveInteger,
  parseJsonBody,
  requireAiRouteContext,
  validateCompanyScope,
} from '../../_lib/route-helpers'
import { legacyRunRetirement } from './retirement'

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

  return NextResponse.json(legacyRunRetirement(skillKey), { status: 410 })
}
