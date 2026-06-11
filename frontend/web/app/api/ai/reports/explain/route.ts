/**
 * POST /api/ai/reports/explain — explain a company-scoped report payload.
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
  validateCompanyScope,
} from '../../_lib/route-helpers'

function sanitizeReportLines(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const lines = raw
    .slice(0, 500)
    .map((line) => sanitizeJsonValue(line))
    .filter((line) => line !== undefined)
  return lines.length > 0 ? lines : undefined
}

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

  const reportId = optionalPositiveInteger(body.reportId ?? body.report_id)
  const reportType = sanitizeIdentifier(body.reportType ?? body.report_type, 120)
  const reportPayload = sanitizeRecord(body.reportPayload ?? body.report_payload ?? body.report)
  const reportPayloadLines =
    reportPayload && Array.isArray(reportPayload.lines) ? reportPayload.lines : undefined
  const reportLines = sanitizeReportLines(
    body.reportLines ?? body.report_lines ?? body.lines ?? reportPayloadLines,
  )
  const comparisonLines = sanitizeReportLines(
    body.comparisonLines ?? body.comparison_lines ?? reportPayload?.comparison_lines,
  )
  const question = boundedString(body.question, 1_000)

  if (!reportType) return NextResponse.json({ error: 'report_type is required' }, { status: 400 })
  if (!reportLines?.length) {
    return NextResponse.json({ error: 'report_lines are required' }, { status: 400 })
  }

  return proxyAiGateway('/v1/reports/explain', {
    org_id: orgId,
    company_id: companyId,
    ...(reportId !== undefined ? { report_id: String(reportId) } : {}),
    report_type: reportType,
    lines: reportLines,
    ...(comparisonLines?.length ? { comparison_lines: comparisonLines } : {}),
    include_explanation: question ? true : body.include_explanation === true,
  })
}
