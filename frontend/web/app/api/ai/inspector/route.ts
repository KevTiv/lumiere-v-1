/**
 * POST /api/ai/inspector — source/decision/claim/component inspector (AIH-16).
 *
 * Protected BFF proxying the ai-gateway `POST /v1/inspector` endpoint. The
 * body must carry exactly one target id matching `viewKind`; the org is
 * derived from the session server-side and never taken from the body.
 */
import { type NextRequest, NextResponse } from "next/server"

import { fetchAiGateway, resolveAiGatewayBaseUrl } from "@/lib/ai-gateway-server"
import {
  parseJsonBody,
  positiveInteger,
  requireAiRouteContext,
  validateCompanyScope,
} from "../_lib/route-helpers"

const VIEW_KINDS = ["claim", "decision", "component", "answer"] as const

type ViewKind = (typeof VIEW_KINDS)[number]

function isViewKind(raw: unknown): raw is ViewKind {
  return typeof raw === "string" && VIEW_KINDS.includes(raw as ViewKind)
}

const TARGET_FOR_VIEW_KIND: Record<ViewKind, string> = {
  claim: "claim_id",
  decision: "decision_id",
  component: "component_id",
  answer: "run_id",
}

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const viewKind = body.viewKind ?? body.view_kind
  if (!isViewKind(viewKind)) {
    return NextResponse.json(
      { error: "viewKind must be one of: claim, decision, component, answer" },
      { status: 400 },
    )
  }

  // Company scope is optional; when supplied it must belong to the session org.
  const companyIdRaw = body.companyId ?? body.company_id
  let companyId: number | undefined
  if (companyIdRaw !== undefined && companyIdRaw !== null) {
    const parsed = positiveInteger(companyIdRaw)
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: "companyId must be a positive integer" },
        { status: 400 },
      )
    }
    const companyError = await validateCompanyScope(session, parsed)
    if (companyError) return companyError
    companyId = parsed
  }

  // Exactly one target id, matching the requested view kind.
  const targetIds: Record<string, unknown> = {
    claim_id: body.claimId ?? body.claim_id,
    decision_id: body.decisionId ?? body.decision_id,
    component_id: body.componentId ?? body.component_id,
    run_id: body.runId ?? body.run_id,
  }
  const suppliedKeys = Object.entries(targetIds)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key]) => key)

  if (suppliedKeys.length !== 1) {
    return NextResponse.json(
      {
        error:
          "exactly one of claimId, decisionId, componentId or runId is required",
      },
      { status: 400 },
    )
  }

  const targetKey = suppliedKeys[0]
  const expectedKey = TARGET_FOR_VIEW_KIND[viewKind]
  if (targetKey !== expectedKey) {
    return NextResponse.json(
      { error: `viewKind "${viewKind}" requires ${expectedKey}` },
      { status: 400 },
    )
  }

  const targetId = positiveInteger(targetIds[targetKey])
  if (!Number.isFinite(targetId)) {
    return NextResponse.json(
      { error: `${targetKey} must be a positive integer` },
      { status: 400 },
    )
  }

  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      { error: "AI gateway is not configured" },
      { status: 503 },
    )
  }

  const gatewayBody: Record<string, unknown> = {
    org_id: orgId,
    company_id: companyId ?? null,
    view_kind: viewKind,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
  }
  gatewayBody[targetKey] = targetId

  try {
    const gw = await fetchAiGateway("/v1/inspector", {
      method: "POST",
      body: JSON.stringify(gatewayBody),
    })
    const payload = gw.text
      ? (() => {
        try {
          return JSON.parse(gw.text) as unknown
        } catch {
          return { error: gw.text }
        }
      })()
      : {}
    return NextResponse.json(payload, { status: gw.status })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: "AI gateway request failed", detail },
      { status: 502 },
    )
  }
}
