import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export const POST = (request: NextRequest) => forwardToApiServerRequired(request)
