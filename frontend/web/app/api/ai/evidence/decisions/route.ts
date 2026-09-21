import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned capture of a user contribution and its proposed decision. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
