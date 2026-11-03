import { NextResponse, type NextRequest } from "next/server"

import { forwardToApiServerRequired } from "@/lib/api-server-forward"
import { fetchAiGateway } from "@/lib/ai-gateway-server"
import { requireAiRouteContext } from "../../_lib/route-helpers"

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("view") === "native-bindings") {
    const context = await requireAiRouteContext(request)
    if (!context.ok) return context.response
    try {
      const gateway = await fetchAiGateway("/v1/internal/harness/skill-bindings", { method: "GET" })
      return new NextResponse(gateway.text, {
        status: gateway.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      })
    } catch {
      return NextResponse.json({ error: "Current harness bindings are unavailable" }, { status: 503 })
    }
  }
  return forwardToApiServerRequired(request)
}

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}
