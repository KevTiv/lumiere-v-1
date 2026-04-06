/**
 * POST /api/proposals/analyze — proxied to Rust `api-server` `/v1/proposals/analyze`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
