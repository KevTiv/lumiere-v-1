/**
 * Bucket-ready gate: document indexing remains disabled until FileAsset/FileVersion exists.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { deferredIndexingResponse } from '../../_lib/indexing-gates'
import { requireAiRouteContext } from '../../_lib/route-helpers'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const gate = deferredIndexingResponse('document')
  return NextResponse.json(gate.body, { status: gate.status })
}
