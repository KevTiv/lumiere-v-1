/**
 * Settings roles — proxied to Rust `api-server` `/v1/settings/roles`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
