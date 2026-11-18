import "server-only"

import type { NextRequest } from "next/server"

import { fetchAiGateway, resolveAiGatewayBaseUrl } from "@/lib/ai-gateway-server"
import { resolveApiSession } from "@/lib/api-session"

/**
 * Ask the gateway to index this actor's queued records, using the actor's own live
 * session. No credential is stored: a job with no session simply waits. Never throws,
 * so it cannot affect the ERP write that triggered it.
 */
export async function kickAiIndexDrain(request: NextRequest): Promise<void> {
  try {
    if (!resolveAiGatewayBaseUrl()) return
    const session = await resolveApiSession(request)
    if (!session || session.organizationId === undefined || session.organizationId <= 0) return
    await fetchAiGateway("/v1/context/index-jobs/drain", {
      method: "POST",
      body: JSON.stringify({
        org_id: session.organizationId,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
      }),
    })
  } catch {
    // Best effort by design; queued jobs retry on the actor's next write.
  }
}
