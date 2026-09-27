import type { NextRequest } from 'next/server'

import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Session-owned evidence revocation/deletion; the reducer keeps the lifecycle authoritative. */
export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
