import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
