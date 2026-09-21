import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned run evidence export; authorization and scope are enforced by api-server. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
