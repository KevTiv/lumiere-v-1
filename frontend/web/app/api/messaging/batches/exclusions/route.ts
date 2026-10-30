import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export const GET = (request: NextRequest) => forwardToApiServerRequired(request)
