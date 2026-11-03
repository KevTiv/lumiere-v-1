/**
 * POST /api/ai/import/analyze — suggest CSV column mappings for a target ERP entity.
 */
import { type NextRequest, NextResponse } from "next/server"
import { parseImportJsonBody } from "../_body"

import { sanitizeImportSkillInputs } from "@lumiere/erp-shared/csv-import-safety"

import {
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeIdentifier,
} from "../../_lib/route-helpers"

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseImportJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const body = bodyResult.body
  const targetEntity = sanitizeIdentifier(
    body.targetEntity ?? body.target_entity,
    80,
  )
  if (!targetEntity) {
    return NextResponse.json(
      { error: "targetEntity is required" },
      { status: 400 },
    )
  }

  let inspected: Record<string, unknown>
  try {
    inspected = sanitizeImportSkillInputs({
      ...body,
      target_entity: targetEntity,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return proxyAiGateway("/v1/import/analyze", {
    ...inspected,
  })
}
