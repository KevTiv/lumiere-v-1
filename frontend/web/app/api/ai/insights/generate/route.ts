/**
 * POST /api/ai/insights/generate — manually generate company-scoped AI insights.
 */
import { type NextRequest } from 'next/server'

import {
  optionalPositiveInteger,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
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

  const resource = sanitizeIdentifier(body.resource, 120)
  const scope = sanitizeRecord(body.scope)

  return proxyAiGateway('/v1/insights/generate', {
    org_id: orgId,
    company_id: companyId,
    ...(resource ? { resource } : {}),
    ...(scope ? { scope } : {}),
    ...(body.force === true ? { force: true } : {}),
  })
}
