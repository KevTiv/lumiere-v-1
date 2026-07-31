/** GET /api/bootstrap/currencies — active currencies available before tenant creation. */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
