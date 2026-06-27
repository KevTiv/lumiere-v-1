/**
 * POST /api/ai/import/analyze — suggest CSV column mappings for a target ERP entity.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { assertCsvSafeForAi, parseCsvText } from '@lumiere/erp-shared/csv-import-safety'

import {
  boundedString,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  sanitizeRecord,
} from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const body = bodyResult.body
  const targetEntity = sanitizeIdentifier(body.targetEntity ?? body.target_entity, 80)
  if (!targetEntity) {
    return NextResponse.json({ error: 'targetEntity is required' }, { status: 400 })
  }

  const csvText = boundedString(body.csvText ?? body.csv_text, 512_000)
  let headers = Array.isArray(body.headers)
    ? body.headers.filter((value): value is string => typeof value === 'string').slice(0, 200)
    : []
  const rawSampleRows = body.sampleRows ?? body.sample_rows
  let sampleRows = Array.isArray(rawSampleRows)
    ? rawSampleRows
        .filter((row): row is unknown[] => Array.isArray(row))
        .slice(0, 50)
        .map((row) => row.filter((cell): cell is string => typeof cell === 'string'))
    : []

  if (csvText) {
    try {
      const parsed = parseCsvText(csvText)
      headers = parsed.headers
      sampleRows = parsed.rows.slice(0, 50)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  if (headers.length === 0) {
    return NextResponse.json({ error: 'headers or csvText is required' }, { status: 400 })
  }

  try {
    assertCsvSafeForAi(headers, sampleRows)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const priorMappings = sanitizeRecord(body.priorMappings ?? body.prior_mappings) ?? {}
  const bundleKey = boundedString(body.bundleKey ?? body.bundle_key, 80)

  return proxyAiGateway('/v1/import/analyze', {
    target_entity: targetEntity,
    headers,
    sample_rows: sampleRows,
    prior_mappings: priorMappings,
    ...(bundleKey ? { bundle_key: bundleKey } : {}),
  })
}
