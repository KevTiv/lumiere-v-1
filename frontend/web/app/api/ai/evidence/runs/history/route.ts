import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned run history; authorization, scope and pagination are enforced server-side. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
