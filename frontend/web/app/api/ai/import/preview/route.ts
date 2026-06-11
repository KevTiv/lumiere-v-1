/**
 * POST /api/ai/import/preview — preview normalized rows for an import mapping.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
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
    .slice(0, 100)
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

  const sampleRows = sanitizeRows(body.sampleRows ?? body.sample_rows ?? body.rows)
  if (sampleRows.length === 0) {
    return NextResponse.json({ error: 'sample_rows are required' }, { status: 400 })
  }

  const mapping = sanitizeRecord(body.mapping)
  if (!mapping) return NextResponse.json({ error: 'mapping is required' }, { status: 400 })

  const transforms = sanitizeRecord(body.transforms)

  return proxyAiGateway('/v1/import/preview', {
    org_id: orgId,
    ...(companyId !== undefined ? { company_id: companyId } : {}),
    target_entity: targetEntity,
    headers: header,
    rows: sampleRows,
    mapping,
    ...(transforms ? { transforms } : {}),
  })
}
