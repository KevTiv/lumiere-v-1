/**
 * POST /api/import/{entity} — proxied to Rust `api-server` `/v1/import/{entity}`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
