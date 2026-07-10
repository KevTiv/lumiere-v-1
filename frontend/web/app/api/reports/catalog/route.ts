import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

/**
 * GET /api/reports/catalog
 *
 * Proxies to the Rust api-server's typed report catalog. Session and
 * organization membership are derived from cookies/Authorization on the
 * api-server; this route does not trust browser-supplied scope.
 */
export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
