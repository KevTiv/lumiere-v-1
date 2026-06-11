/**
 * POST /api/ai/briefing — permission-scoped activity briefing generation.
 */
import { type NextRequest } from 'next/server'

import {
  optionalPositiveInteger,
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  sanitizeRecord,
  sanitizeStringList,
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
  if (companyId !== undefined) {
    const companyError = await validateCompanyScope(session, companyId)
    if (companyError) return companyError
  }

  const sinceMicros = positiveInteger(body.sinceMicros ?? body.since_micros ?? body.since)
  const window = sanitizeIdentifier(body.window, 80)
  const resources = sanitizeStringList(body.resources ?? body.resource_scope, 50, 120)
  const resourceFilters = sanitizeRecord(body.resourceFilters ?? body.resource_filters)

  return proxyAiGateway('/v1/briefing/generate', {
    org_id: orgId,
    ...(companyId !== undefined ? { company_id: companyId } : {}),
    ...(Number.isFinite(sinceMicros) && sinceMicros > 0 ? { since_micros: sinceMicros } : {}),
    ...(window ? { window } : {}),
    ...(resources?.length ? { resources } : {}),
    ...(resourceFilters ? { resource_filters: resourceFilters } : {}),
  })
}
