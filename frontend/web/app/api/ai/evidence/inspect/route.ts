import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned proxy; actor grants and company scope are enforced by api-server. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
