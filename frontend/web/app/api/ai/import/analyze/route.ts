/**
 * POST /api/ai/import/analyze — propose CSV/header to ERP field mappings.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  boundedString,
  optionalPositiveInteger,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  sanitizeJsonValue,
  sanitizeRecord,
  sanitizeStringList,
  validateCompanyScope,
} from '../../_lib/route-helpers'

function sanitizeRows(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 50)
    .map((row) => sanitizeJsonValue(row))
    .filter((row) => row !== undefined)
}

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

  const targetEntity = sanitizeIdentifier(body.targetEntity ?? body.target_entity, 120)
  if (!targetEntity) return NextResponse.json({ error: 'target_entity is required' }, { status: 400 })

  const header = sanitizeStringList(body.header ?? body.headers, 200, 160)
  if (!header?.length) return NextResponse.json({ error: 'header is required' }, { status: 400 })

  const sampleRows = sanitizeRows(body.sampleRows ?? body.sample_rows)
  const priorMappings = sanitizeRecord(body.priorMappings ?? body.prior_mappings)
  const instructions = boundedString(body.instructions, 2_000)

  return proxyAiGateway('/v1/import/analyze', {
    org_id: orgId,
    ...(companyId !== undefined ? { company_id: companyId } : {}),
    target_entity: targetEntity,
    headers: header,
    sample_rows: sampleRows,
    ...(priorMappings ? { prior_mappings: priorMappings } : {}),
    ...(instructions ? { instructions } : {}),
  })
}
