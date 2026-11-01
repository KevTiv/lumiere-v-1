import { NextResponse, type NextRequest } from "next/server"
import { readReportReadiness } from "@/lib/report-readiness-server"
import { parseReadinessIntent } from "@/lib/report-readiness"
import { parseJsonBody, requireAiRouteContext, validateCompanyScope } from "../../../_lib/route-helpers"

const noStore = (response: NextResponse) => { response.headers.set("Cache-Control", "no-store"); return response }
/** No writes, policy refresh, provider calls, or certificate activation. */
export async function POST(request: NextRequest) {
  const context = await requireAiRouteContext(request)
  if (!context.ok) return noStore(context.response)
  const body = await parseJsonBody(request)
  if (!body.ok) return noStore(body.response)
  const intent = parseReadinessIntent(body.body)
  if (!intent) return noStore(NextResponse.json({ error: "Company and agent are required" }, { status: 400 }))
  const { session, orgId } = context.context
  if (!session.identityHex || session.identityHex === "unknown" || !session.stdbToken.trim()) {
    return noStore(NextResponse.json({ error: "Authenticated actor context required" }, { status: 403 }))
  }
  const denied = await validateCompanyScope(session, intent.companyId)
  if (denied) return noStore(denied)
  const result = await readReportReadiness({ organizationId: orgId, ...intent, actorIdentity: session.identityHex, stdbToken: session.stdbToken })
  return noStore(NextResponse.json(result))
}
