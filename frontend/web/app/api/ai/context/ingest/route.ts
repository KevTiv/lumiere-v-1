/**
 * POST /api/ai/context/ingest — manually trigger ERP activity ingestion for this organization.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  return NextResponse.json(
    {
      error:
        'Activity indexing is deferred until an authorized indexing projection is available',
    },
    { status: 503 },
  )
}
