import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned reviewer verdict; reducer permissions remain authoritative. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
