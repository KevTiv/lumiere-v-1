import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

/**
 * POST /api/reports/[reportKey]/preview
 *
 * Proxies to the Rust api-server's scoped report preview. The request body
 * may contain `companyId`, `date`, and `timezone`; organization context is
 * derived from the session on the api-server, not from browser-supplied scope.
 */
export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
