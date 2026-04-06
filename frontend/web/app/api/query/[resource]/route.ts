/**
 * GET /api/query/:resource — proxied to Rust `api-server` `/v1/query/:resource`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(
  request: NextRequest,
  _ctx: { params: Promise<{ resource: string }> },
) {
  return forwardToApiServerRequired(request)
}
