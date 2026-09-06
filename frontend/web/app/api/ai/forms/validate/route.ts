/**
 * POST /api/ai/forms/validate — read-only, schema-level form validation.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
  requireAiRouteContext,
  validateCompanyScope,
} from '../../_lib/route-helpers'
import { aliasString, sanitizeFields } from '../../_lib/form-request'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { session, orgId } = contextResult.context

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response
  const body = bodyResult.body

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const scopeError = await validateCompanyScope(session, companyId)
  if (scopeError) return scopeError

  const formId = aliasString(body, 'formId', 'form_id')
  const entityType = aliasString(body, 'entityType', 'entity_type')
  const fields = sanitizeFields(body.fields)
  const values =
    body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values
      : {}

  if (!formId) return NextResponse.json({ error: 'form_id is required' }, { status: 400 })
  if (!entityType) return NextResponse.json({ error: 'entity_type is required' }, { status: 400 })
  if (fields.length === 0) return NextResponse.json({ error: 'fields are required' }, { status: 400 })

  return proxyAiGateway('/v1/forms/validate', {
    org_id: orgId,
    company_id: companyId,
    form_id: formId,
    entity_type: entityType,
    fields,
    values,
  })
}
