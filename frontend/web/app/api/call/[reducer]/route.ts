/**
 * POST /api/call/:reducer — proxied to Rust `api-server` `/v1/call/:reducer`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function POST(
  request: NextRequest,
  _ctx: { params: Promise<{ reducer: string }> },
) {
  return forwardToApiServerRequired(request)
}
