import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function PATCH(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
