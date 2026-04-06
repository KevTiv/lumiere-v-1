/**
 * GET /api/stdb/subscription-queries — implemented by Rust `api-server` (`/v1/stdb/subscription-queries`).
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
