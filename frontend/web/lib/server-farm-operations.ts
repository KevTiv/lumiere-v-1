import "server-only"

import type { ApiSession } from "@/lib/api-session"
import { resolveApiServerBaseUrl } from "@/lib/api-server-forward"
import { sessionAllowsPermission } from "@/lib/session-permissions"

export async function serverFarmOperationsEnabled(
  session: ApiSession,
  companyId: number,
): Promise<boolean> {
  if (!sessionAllowsPermission(session, "farm_batch", "read")) return false
  const base = resolveApiServerBaseUrl()
  if (!base) return false
  try {
    const response = await fetch(`${base}/v1/vertical-packs/${companyId}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.stdbToken}`,
        "x-stdb-identity": session.identityHex,
      },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return false
    const payload: { data?: unknown } = await response.json()
    return Array.isArray(payload.data) && payload.data.some((pack) =>
      pack?.packKey === "farm_operations" &&
      String(pack.companyId) === String(companyId) &&
      pack.enabled === true,
    )
  } catch {
    return false
  }
}
