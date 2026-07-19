import { type NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function PUT(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
