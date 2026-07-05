/**
 * POST /api/mail/dispatch-queued — proxied to Rust `api-server` `/v1/mail/dispatch-queued`.
 */

import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
