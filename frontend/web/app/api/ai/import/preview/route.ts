/**
 * POST /api/ai/import/preview — preview mapped CSV rows before reducer import.
 */
import { type NextRequest, NextResponse } from "next/server"
import { parseImportJsonBody } from "../_body"

import {
  assertCsvSafeForAi,
  parseCsvText,
} from "@lumiere/erp-shared/csv-import-safety"

import {
  boundedInteger,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  sanitizeRecord,
} from "../../_lib/route-helpers"

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseImportJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const body = bodyResult.body
  const targetEntity = sanitizeIdentifier(
    body.targetEntity ?? body.target_entity,
    80,
  )
  if (!targetEntity) {
    return NextResponse.json(
      { error: "targetEntity is required" },
      { status: 400 },
    )
  }

  const mapping = sanitizeRecord(body.mapping)
  if (!mapping || Object.keys(mapping).length === 0) {
    return NextResponse.json({ error: "mapping is required" }, { status: 400 })
  }

  const csvText = body.csvText ?? body.csv_text
  let headers = (body.headers ?? []) as string[]
  let rows = (body.rows ??
    body.sampleRows ??
    body.sample_rows ??
    []) as string[][]

  if (csvText !== undefined) {
    try {
      if (typeof csvText !== "string")
        throw new Error("CSV text must be a string")
      const parsed = parseCsvText(csvText)
      headers = parsed.headers
      rows = parsed.rows
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  if (!Array.isArray(headers) || headers.length === 0) {
    return NextResponse.json(
      { error: "headers or csvText is required" },
      { status: 400 },
    )
  }

  try {
    assertCsvSafeForAi(headers, rows)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const maxRows = boundedInteger(body.maxRows ?? body.max_rows, 25, 1, 100)

  return proxyAiGateway("/v1/import/preview", {
    target_entity: targetEntity,
    headers,
    rows,
    mapping,
    max_rows: maxRows,
  })
}
