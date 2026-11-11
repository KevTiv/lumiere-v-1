/**
 * POST /api/bootstrap/tenant — proxied to Rust `api-server` `/v1/bootstrap/tenant`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

/** Read only the authenticated user's own organization bootstrap metadata. */
export async function GET(request: NextRequest) {
  const response = await forwardToApiServerRequired(request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
