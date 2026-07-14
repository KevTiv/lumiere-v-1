import type { NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function GET(request: NextRequest) {
  return forwardToApiServerRequired(request)
}

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
