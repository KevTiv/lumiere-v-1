/**
 * POST /api/ai/rag — retrieval-augmented answers scoped to an ERP company the user can access.
 */
import { type NextRequest } from 'next/server'

import {
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
} from '../_lib/route-helpers'
import { prepareRagPayload } from '../_lib/rag-request'

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response
  const { session, orgId } = contextResult.context

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const ragResult = await prepareRagPayload({
    body: bodyResult.body,
    session,
    orgId,
  })
  if (!ragResult.ok) return ragResult.response

  return proxyAiGateway('/v1/rag', ragResult.payload as unknown as Record<string, unknown>)
}
