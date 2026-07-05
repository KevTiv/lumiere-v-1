/**
 * GET /api/documents/csv/:kind/:id — proxied to Rust `api-server` CSV routes.
 */

import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
