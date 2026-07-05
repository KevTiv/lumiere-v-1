/**
 * GET /api/documents/pdf/:kind/:id — proxied to Rust `api-server` PDF routes.
 */

import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
