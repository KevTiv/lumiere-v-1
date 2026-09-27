import { NextResponse, type NextRequest } from "next/server"

import {
  optionalPositiveInteger,
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeRecord,
  validateCompanyScope,
} from "../_lib/route-helpers"
import { resolveAiPrivacyPolicy } from "../_lib/ai-privacy-policy"
import { buildTrustedGovernedLlmRequest } from "./_governed-llm-contract"

const GATEWAY_PATHS = {
  "report-analysis": "/v1/skills/report-analysis",
  "process-research": "/v1/skills/process-research",
  "price-search": "/v1/skills/price-search",
  "supplier-discovery": "/v1/skills/supplier-discovery",
} as const

type GovernedLlmSkillSlug = keyof typeof GATEWAY_PATHS

function parseOptionalMaxSteps(raw: unknown): number | null {
  let maxSteps: number | undefined
  if (typeof raw === "number") {
    maxSteps = raw
  } else if (typeof raw === "string") {
    maxSteps = Number(raw)
  }
  return maxSteps != null && Number.isFinite(maxSteps) ? maxSteps : null
}

async function postGovernedLlmSkill(
  request: NextRequest,
  skillSlug: GovernedLlmSkillSlug,
) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const inputs = sanitizeRecord(body.inputs) ?? {}
  const agentId = optionalPositiveInteger(body.agentId ?? body.agent_id) ?? null
  const teamMemberId =
    optionalPositiveInteger(body.teamMemberId ?? body.team_member_id) ?? null
  const maxSteps = parseOptionalMaxSteps(body.maxSteps ?? body.max_steps)
  const resumeRunId =
    optionalPositiveInteger(body.resumeRunId ?? body.resume_run_id) ?? null
  const orgPrivacyPolicy = resolveAiPrivacyPolicy(session.fieldAccess)

  if (skillSlug === "report-analysis") {
    if (!session.identityHex || session.identityHex === "unknown" || !session.stdbToken.trim()) {
      return NextResponse.json(
        { error: "Authenticated actor context required" },
        { status: 403 },
      )
    }
    const trusted = buildTrustedGovernedLlmRequest(
      { inputs, agentId, teamMemberId, maxSteps, resumeRunId, orgPrivacyPolicy },
      {
        organizationId: orgId,
        companyId: companyId as number,
        actorIdentity: session.identityHex,
        stdbToken: session.stdbToken,
      },
    )
    return proxyAiGateway(GATEWAY_PATHS[skillSlug], trusted.body, trusted.headers)
  }

  return proxyAiGateway(GATEWAY_PATHS[skillSlug], {
    org_id: orgId,
    company_id: companyId,
    inputs,
    agent_id: agentId,
    team_member_id: teamMemberId,
    max_steps: maxSteps,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
    org_privacy_policy: orgPrivacyPolicy,
  })
}

export const postReportAnalysis = (request: NextRequest) =>
  postGovernedLlmSkill(request, "report-analysis")
export const postProcessResearch = (request: NextRequest) =>
  postGovernedLlmSkill(request, "process-research")
export const postPriceSearch = (request: NextRequest) =>
  postGovernedLlmSkill(request, "price-search")
export const postSupplierDiscovery = (request: NextRequest) =>
  postGovernedLlmSkill(request, "supplier-discovery")
