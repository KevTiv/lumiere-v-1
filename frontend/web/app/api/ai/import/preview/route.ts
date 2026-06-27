/**
 * POST /api/ai/import/preview — preview mapped CSV rows before reducer import.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { assertCsvSafeForAi, parseCsvText } from '@lumiere/erp-shared/csv-import-safety'

import {
  boundedInteger,
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

  const mapping = sanitizeRecord(body.mapping)
  if (!mapping || Object.keys(mapping).length === 0) {
    return NextResponse.json({ error: 'mapping is required' }, { status: 400 })
  }

  const csvText = boundedString(body.csvText ?? body.csv_text, 512_000)
  let headers = Array.isArray(body.headers)
    ? body.headers.filter((value): value is string => typeof value === 'string').slice(0, 200)
    : []
  let rows = Array.isArray(body.rows ?? body.sampleRows ?? body.sample_rows)
    ? (body.rows ?? body.sampleRows ?? body.sample_rows as unknown[])
        .filter((row): row is unknown[] => Array.isArray(row))
        .slice(0, 100)
        .map((row) => row.filter((cell): cell is string => typeof cell === 'string'))
    : []

  if (csvText) {
    try {
      const parsed = parseCsvText(csvText)
      headers = parsed.headers
      rows = parsed.rows.slice(0, 100)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  if (headers.length === 0) {
    return NextResponse.json({ error: 'headers or csvText is required' }, { status: 400 })
  }

  try {
    assertCsvSafeForAi(headers, rows)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const maxRows = boundedInteger(body.maxRows ?? body.max_rows, 25, 1, 100)

  return proxyAiGateway('/v1/import/preview', {
    target_entity: targetEntity,
    headers,
    rows,
    mapping,
    max_rows: maxRows,
  })
}
