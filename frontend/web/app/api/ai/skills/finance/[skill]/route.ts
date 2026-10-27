import { NextResponse, type NextRequest } from "next/server"
import {
  parseJsonBody,
  positiveInteger,
  optionalPositiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
  sanitizeRecord,
  proxyAiGateway,
} from "../../../_lib/route-helpers"
import { resolveAiPrivacyPolicy } from "../../../_lib/ai-privacy-policy"
import { buildTrustedGovernedLlmRequest } from "../../_governed-llm-contract"
import { callReducer } from "@/lib/stdb-reducer"

const skills = new Set([
  "finance_report_review",
  "bank_reconciliation_review",
  "period_close_review",
  "expense_evidence_review",
  "finance_variance_review",
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skill: string }> },
) {
  const { skill } = await params
  if (!skills.has(skill))
    return NextResponse.json(
      { error: "Unknown finance skill" },
      { status: 404 },
    )
  const context = await requireAiRouteContext(request)
  if (!context.ok) return context.response
  const parsed = await parseJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { session, orgId } = context.context
  const body = parsed.body
  const companyId = positiveInteger(body.companyId)
  if (!Number.isSafeInteger(companyId) || companyId <= 0)
    return NextResponse.json(
      { error: "A valid company is required" },
      { status: 400 },
    )
  const denied = await validateCompanyScope(session, companyId ?? NaN)
  if (denied) return denied
  if (
    !session.identityHex ||
    session.identityHex === "unknown" ||
    !session.stdbToken.trim()
  )
    return NextResponse.json(
      { error: "Authenticated actor context required" },
      { status: 403 },
    )
  const inputs = sanitizeRecord(body.inputs)
  if (!inputs)
    return NextResponse.json(
      { error: "Finance parameters are required" },
      { status: 400 },
    )
  const agentId = optionalPositiveInteger(body.agentId)
  const resumeRunId = optionalPositiveInteger(body.resumeRunId)
  if (
    [agentId, resumeRunId].some(
      (value) =>
        value !== undefined && (!Number.isSafeInteger(value) || value <= 0),
    ) ||
    ["recordId", "statementId", "periodId"].some(
      (key) =>
        key in inputs &&
        (!Number.isSafeInteger(inputs[key]) || Number(inputs[key]) <= 0),
    )
  )
    return NextResponse.json(
      { error: "Record and agent identities must be exact positive integers" },
      { status: 400 },
    )
  try {
    await callReducer("refresh_policy_snapshot", [orgId], session.opts)
  } catch {
    return NextResponse.json(
      { error: "Authorization refresh unavailable. No review was started." },
      { status: 503 },
    )
  }
  const trusted = buildTrustedGovernedLlmRequest(
    {
      inputs,
      agentId: agentId ?? null,
      teamMemberId: null,
      maxSteps: null,
      resumeRunId: resumeRunId ?? null,
      orgPrivacyPolicy: resolveAiPrivacyPolicy(session.fieldAccess),
    },
    {
      organizationId: orgId,
      companyId: companyId!,
      actorIdentity: session.identityHex,
      stdbToken: session.stdbToken,
    },
  )
  return proxyAiGateway(
    `/v1/skills/finance/${skill}`,
    trusted.body,
    trusted.headers,
  )
}
