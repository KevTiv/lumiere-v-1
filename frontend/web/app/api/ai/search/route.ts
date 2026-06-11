/**
 * POST /api/ai/search — company-scoped semantic command/record search.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  boundedInteger,
  boundedNumber,
  boundedString,
  optionalPositiveInteger,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  validateCompanyScope,
} from '../_lib/route-helpers'

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

  const query = boundedString(body.query, 1_000)
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  const contentType = sanitizeIdentifier(body.contentType ?? body.content_type, 80)
  const limit = boundedInteger(body.limit, 20, 1, 40)
  const scoreThreshold = boundedNumber(body.scoreThreshold ?? body.score_threshold, undefined, 0, 1)

  return proxyAiGateway('/v1/search', {
    org_id: orgId,
    company_id: companyId,
    query,
    ...(contentType ? { content_type: contentType.toLowerCase().replaceAll('-', '_') } : {}),
    limit,
    ...(scoreThreshold !== undefined ? { score_threshold: scoreThreshold } : {}),
  })
}
