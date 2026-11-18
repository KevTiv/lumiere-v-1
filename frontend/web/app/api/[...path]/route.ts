import { after, type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'
import { kickAiIndexDrain } from '@/lib/ai-index-drain'
import { isOperationWrite } from '@/lib/ai-index-drain-path'

export const GET = (request: NextRequest) => forwardToApiServerRequired(request)
export const POST = async (request: NextRequest) => {
  const response = await forwardToApiServerRequired(request)
  // The write already committed; indexing runs after the response and cannot fail it.
  if (response.ok && isOperationWrite(request.method, new URL(request.url).pathname)) {
    after(() => kickAiIndexDrain(request))
  }
  return response
}
export const PUT = GET
export const PATCH = GET
export const DELETE = GET
