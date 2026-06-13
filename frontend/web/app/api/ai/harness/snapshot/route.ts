/**
 * POST /api/ai/harness/snapshot — read-only live ERP row snapshots (no full RAG).
 */
import { type NextRequest, NextResponse } from 'next/server'

import { sanitizeRagUiContext } from '@lumiere/erp-shared/ai-ui-context'

import {
  optionalPositiveInteger,
  parseJsonBody,
  proxyAiGateway,
  requireAiRouteContext,
  sanitizeStringList,
  validateCompanyScope,
} from '../../_lib/route-helpers'

type SnapshotEntityInput = {
  entity_type?: unknown
  entityType?: unknown
  entity_id?: unknown
  entityId?: unknown
  priority?: unknown
}

function parseSnapshotEntities(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const out: Array<{ entity_type: string; entity_id: number; priority?: number }> = []
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as SnapshotEntityInput
    const entityType =
      typeof row.entity_type === 'string'
        ? row.entity_type
        : typeof row.entityType === 'string'
          ? row.entityType
          : ''
    const entityIdRaw = row.entity_id ?? row.entityId
    const entityId =
      typeof entityIdRaw === 'number'
        ? Math.floor(entityIdRaw)
        : typeof entityIdRaw === 'string'
          ? Number.parseInt(entityIdRaw, 10)
          : NaN
    if (!entityType.trim() || !Number.isFinite(entityId) || entityId <= 0) continue
    const priority =
      typeof row.priority === 'number' && Number.isFinite(row.priority) ? row.priority : undefined
    out.push({
      entity_type: entityType.trim(),
      entity_id: entityId,
      ...(priority != null ? { priority } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

export async function POST(request: NextRequest) {
  const contextResult = await requireAiRouteContext(request)
  if (!contextResult.ok) return contextResult.response

  const bodyResult = await parseJsonBody(request)
  if (!bodyResult.ok) return bodyResult.response

  const { session, orgId } = contextResult.context
  const body = bodyResult.body

  const companyId = optionalPositiveInteger(body.companyId ?? body.company_id)
  const companyError = await validateCompanyScope(session, companyId ?? NaN)
  if (companyError) return companyError

  const uiContext = sanitizeRagUiContext(body.uiContext ?? body.ui_context)
  const entities = parseSnapshotEntities(body.entities)
  const allowedEntityTypes = sanitizeStringList(
    body.allowedEntityTypes ?? body.allowed_entity_types,
    20,
    120,
  )

  return proxyAiGateway('/v1/harness/snapshot', {
    org_id: orgId,
    company_id: companyId,
    ...(entities?.length ? { entities } : {}),
    ...(uiContext ? { ui_context: uiContext } : {}),
    ...(allowedEntityTypes?.length ? { allowed_entity_types: allowedEntityTypes } : {}),
  })
}
