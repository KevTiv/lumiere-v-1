/**
 * POST /api/ai/context/ingest — manually trigger ERP activity ingestion for this organization.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { deferredIndexingResponse } from '../../_lib/indexing-gates'
import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const gate = deferredIndexingResponse('activity')
  return NextResponse.json(gate.body, { status: gate.status })
}
