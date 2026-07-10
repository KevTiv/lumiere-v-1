import { type NextRequest, NextResponse } from "next/server"

import type {
  ExecutionPlan,
  PolicyControlledRequest,
  SkillVersionRef,
} from "@lumiere/erp-shared/ai-policy-schemas"

import {
  parseJsonBody,
  positiveInteger,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
  sanitizeRecord,
  validateCompanyScope,
} from "../../_lib/route-helpers"

/**
 * POST /api/ai/policy/evaluate
 *
 * Fail-closed policy evaluation BFF. The browser supplies the skill reference,
 * execution plan, and candidate output; this route derives organization and
 * company context from the session and forwards to the AI gateway policy engine.
 */
export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const skill = parseSkillVersionRef(body.skill ?? body.skill_version)
  if (!skill) {
    return NextResponse.json(
      { error: "skill must be an object with skillKey and version" },
      { status: 400 },
    )
  }

  const correlationId = sanitizeIdentifier(body.correlationId ?? body.correlation_id ?? "", 120)
  if (!correlationId) {
    return NextResponse.json(
      { error: "correlationId is required" },
      { status: 400 },
    )
  }

  const plan = parseExecutionPlan(body.plan)
  if (!plan) {
    return NextResponse.json(
      { error: "plan must be a valid ExecutionPlan object" },
      { status: 400 },
    )
  }

  const input = sanitizeRecord(body.input) ?? {}
  const candidateOutput = sanitizeRecord(body.candidateOutput ?? body.candidate_output) ?? {}

  const payload: PolicyControlledRequest = {
    execution: {
      skill,
      organizationId: orgId,
      companyId,
      correlationId,
      metadata: {
        actorId: session.identityHex,
      },
      input,
      plan,
    },
    candidateOutput,
  }

  return proxyAiGateway(
    "/v1/policy/evaluate",
    payload as unknown as Record<string, unknown>,
  )
}

function parseSkillVersionRef(raw: unknown): SkillVersionRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const skillKey =
    typeof obj.skillKey === "string"
      ? obj.skillKey.trim()
      : typeof obj.skill_key === "string"
        ? obj.skill_key.trim()
        : ""
  const version = positiveInteger(obj.version)
  if (!skillKey || !Number.isFinite(version) || version <= 0) return null
  return { skillKey, version }
}

function parseExecutionPlan(raw: unknown): ExecutionPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const namedResources = parseStringArray(obj.namedResources ?? obj.named_resources)
  const steps = positiveInteger(obj.steps)
  const expectedRows = positiveInteger(obj.expectedRows ?? obj.expected_rows)
  const outputType =
    typeof obj.outputType === "string"
      ? obj.outputType.trim()
      : typeof obj.output_type === "string"
        ? obj.output_type.trim()
        : ""

  if (
    namedResources.length === 0 ||
    !Number.isFinite(steps) ||
    steps <= 0 ||
    !Number.isFinite(expectedRows) ||
    !outputType
  ) {
    return null
  }

  const toolCalls = parsePlannedToolCalls(obj.toolCalls ?? obj.tool_calls)
  if (toolCalls === null) return null

  return {
    namedResources,
    toolCalls,
    steps,
    expectedRows,
    outputType,
  }
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
}

function parsePlannedToolCalls(raw: unknown): ExecutionPlan["toolCalls"] | null {
  if (!Array.isArray(raw)) return null
  const out: ExecutionPlan["toolCalls"] = []
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const toolName =
      typeof item.toolName === "string"
        ? item.toolName.trim()
        : typeof item.tool_name === "string"
          ? item.tool_name.trim()
          : ""
    const capability = typeof item.capability === "string" ? item.capability.trim() : ""
    if (!toolName || !isCapability(capability)) return null
    out.push({
      toolName,
      capability,
      namedResource:
        typeof item.namedResource === "string"
          ? item.namedResource.trim()
          : typeof item.named_resource === "string"
            ? item.named_resource.trim()
            : undefined,
    })
  }
  return out
}

function isCapability(value: string): value is ExecutionPlan["toolCalls"][number]["capability"] {
  return [
    "named_read",
    "action_draft",
    "action_execute",
    "raw_sql",
    "network",
    "filesystem",
  ].includes(value)
}
