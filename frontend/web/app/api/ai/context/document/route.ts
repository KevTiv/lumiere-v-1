/**
 * Bucket-ready gate: document indexing remains disabled until FileAsset/FileVersion exists.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  return NextResponse.json(
    {
      error:
        'Document indexing is deferred until the authoritative bucket/FileVersion lifecycle is available',
    },
    { status: 503 },
  )
}
