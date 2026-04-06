/**
 * SpacetimeDB HTTP proxy under `/api/stdb/*` — implemented by Rust `api-server` (`/v1/stdb/*`).
 * Same-origin base for browser SDK / websocket-token when using the Next BFF.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(
  req: NextRequest,
  _ctx: { params: Promise<{ path?: string[] }> },
) {
  return forwardToApiServerRequired(req)
}

export async function POST(
  req: NextRequest,
  _ctx: { params: Promise<{ path?: string[] }> },
) {
  return forwardToApiServerRequired(req)
}

export async function OPTIONS(req: NextRequest) {
  return forwardToApiServerRequired(req)
}
