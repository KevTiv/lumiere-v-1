/**
 * Shared RAG-request preparation for the non-streaming and streaming RAG routes.
 */
import { NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'
import type { ApiSession } from '@/lib/api-session'

import type { JsonObject } from './route-helpers'
import { boundedInteger, positiveInteger, validateCompanyScope } from './route-helpers'

export const MAX_INCLUDE_TYPES = 8

/**
 * Sanitize the `include_types` array: normalize to lowercase snake_case,
 * deduplicate, cap at MAX_INCLUDE_TYPES.
 */
export function sanitizeIncludeTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const seen = new Set<string>()
  const out: string[] = []

  for (const value of raw) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase().replaceAll('-', '_')
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= MAX_INCLUDE_TYPES) break
  }

  return out.length > 0 ? out : undefined
}

export interface RagPayload {
  company_id: number
  org_id: number
  query: string
  limit: number
  stdb_token: string
  identity_hex: string
  include_types?: string[]
  ui_context?: unknown
}

export type RagPrepareResult =
  | { ok: true; payload: RagPayload }
  | { ok: false; response: NextResponse }

/**
 * Common RAG body preparation: query validation, company-scope check,
 * limit clamping, include_types and ui_context sanitization, and payload
 * construction with session credentials.
 *
 * Stream-only fields (agent_id, team_member_id) remain in the calling route.
 */
export async function prepareRagPayload(params: {
  body: JsonObject
  session: ApiSession
  orgId: number
}): Promise<RagPrepareResult> {
  const { body, session, orgId } = params

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'query is required' }, { status: 400 }),
    }
  }

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  const scopeError = await validateCompanyScope(session, companyId)
  if (scopeError) return { ok: false, response: scopeError }

  const limit = boundedInteger(body.limit, 20, 1, 40)
  const include_types = sanitizeIncludeTypes(body.include_types)
  const ui_context = sanitizeRagUiContext(body.ui_context)

  const payload: RagPayload = {
    company_id: companyId,
    org_id: orgId,
    query,
    limit,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
  }
  if (include_types?.length) payload.include_types = include_types
  if (ui_context) payload.ui_context = ui_context

  return { ok: true, payload }
}
