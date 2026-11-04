import { NextResponse, type NextRequest } from "next/server"

import {
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
  requireAiRouteContext,
  validateCompanyScope,
} from "../_lib/route-helpers"

export async function POST(request: NextRequest) {
  const auth = await requireAiRouteContext(request)
  if (!auth.ok) return auth.response

  const parsed = await parseJsonBody(request)
  if (!parsed.ok) return parsed.response

  const { session, orgId } = auth.context
  const { companyId: rawCompanyId, operation, queue, source, from, through } = parsed.body
  const companyId = positiveInteger(rawCompanyId)
  const scopeError = await validateCompanyScope(session, companyId ?? NaN)
  if (scopeError) return scopeError

  if (!session.identityHex || session.identityHex === "unknown" || !session.stdbToken.trim()) {
    return NextResponse.json({ error: "Authenticated actor context required" }, { status: 403 })
  }
  const isComparison =
    operation === "compare_activity" &&
    typeof source === "string" &&
    ["sales", "purchasing", "expenses", "subscriptions"].includes(source) &&
    typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    typeof through === "string" && /^\d{4}-\d{2}-\d{2}$/.test(through)
  if (
    operation !== "coverage" &&
    operation !== "purchasing_reconciliation" &&
    !(operation === "queue" && typeof queue === "string" && queue.length <= 48) &&
    !isComparison
  ) {
    return NextResponse.json({ error: "Unknown or invalid analytics operation" }, { status: 400 })
  }

  const input = operation === "queue" ? { operation, queue }
    : isComparison ? { operation, source, from, through } : { operation }
  return proxyAiGateway(
    "/v1/alpha/analytics",
    input,
    {
      "x-lumiere-organization-id": String(orgId),
      "x-lumiere-company-id": String(companyId),
      "x-lumiere-actor-identity": session.identityHex,
      "x-lumiere-actor-token": session.stdbToken,
    },
  )
}
