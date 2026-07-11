import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

/** Trusted server-rendered owner-report PDF; the browser never supplies HTML. */
export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
