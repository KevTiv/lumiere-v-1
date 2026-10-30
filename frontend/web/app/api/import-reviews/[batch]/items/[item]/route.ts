import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"
export function PATCH(request: NextRequest) { return forwardToApiServerRequired(request) }
