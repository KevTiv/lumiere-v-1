import { type NextRequest, NextResponse } from "next/server"
import { canManagePlatformAiProfile } from "@/lib/platform-ai-authority"
import { parsePlatformAiProfile } from "@/lib/ai-platform-profile"
import { parseJsonBody, proxyAiGateway, requireAiRouteContext } from "../../_lib/route-helpers"

async function handle(request: NextRequest, write: boolean) {
  const context = await requireAiRouteContext(request)
  if (!context.ok) return context.response
  const { orgId, session } = context.context
  if (!session.stdbToken?.trim()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canManagePlatformAiProfile(session)) {
    return NextResponse.json({ error: "Platform administrator access is required" }, { status: 403 })
  }
  let profile
  if (write) {
    const parsed = await parseJsonBody(request)
    if (!parsed.ok) return parsed.response
    try {
      profile = parsePlatformAiProfile(parsed.body)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid AI profile" }, { status: 400 })
    }
  }
  return proxyAiGateway("/v1/harness/platform-profile", {
    org_id: orgId,
    stdb_token: session.stdbToken,
    ...(profile ? { profile } : {}),
  })
}

export async function GET(request: NextRequest) { return handle(request, false) }
export async function POST(request: NextRequest) { return handle(request, true) }
