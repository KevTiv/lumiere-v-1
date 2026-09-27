import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/**
 * Record a user-authored discussion contribution. Identity is the authenticated
 * token's `ctx.sender()`; the browser cannot select a contributor or agent run.
 */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
