import { type NextRequest, NextResponse } from "next/server"

import { sessionAllowsPermission } from "@/lib/session-permissions"
import { proxyAiGateway, requireAiRouteContext } from "../../_lib/route-helpers"

/** Register missing built-in surfaces under the authenticated administrator. */
export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const { orgId, session } = contextResult.context
  if (typeof session.stdbToken !== "string" || !session.stdbToken.trim()) {
    return NextResponse.json(
      { error: "An authenticated user token is required" },
      { status: 401 },
    )
  }
  if (!sessionAllowsPermission(session, "ai_skill", "create")) {
    return NextResponse.json(
      { error: "Skill creation permission is required to run setup" },
      { status: 403 },
    )
  }

  // Scope and credentials come only from the verified session. The gateway
  // registers skills through the API's authenticated session bridge.
  return proxyAiGateway("/v1/skills/provision-surfaces", {
    org_id: orgId,
    stdb_token: session.stdbToken,
  })
}
