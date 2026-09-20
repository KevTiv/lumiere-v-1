import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned document evidence ingestion; company scope is enforced by api-server. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
