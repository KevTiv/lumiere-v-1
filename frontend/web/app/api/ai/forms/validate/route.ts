/**
 * POST /api/ai/forms/validate — read-only, schema-level form validation.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { companyIdBelongsToOrganization } from '@/lib/company-scope-server'
import { resolveApiSession } from '@/lib/api-session'

interface Body {
  company_id?: unknown
  companyId?: unknown
  form_id?: unknown
  formId?: unknown
  entity_type?: unknown
  entityType?: unknown
  fields?: unknown
  values?: unknown
}

const MAX_FIELDS = 80
const SUPPORTED_FIELD_TYPES = new Set([
  'text',
  'email',
  'number',
  'tel',
  'url',
  'textarea',
  'select',
  'checkbox',
  'switch',
  'radio',
  'date',
  'time',
  'datetime',
  'hidden',
])

function positiveInteger(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return NaN
}

function nonEmptyString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function sanitizeFields(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = nonEmptyString(record.name)
    const type = nonEmptyString(record.type)
    if (!name || !SUPPORTED_FIELD_TYPES.has(type) || seen.has(name)) continue
    seen.add(name)

    const field: Record<string, unknown> = {
      name,
      type,
      required: record.required === true,
    }

    const label = nonEmptyString(record.label)
    if (label) field.label = label.slice(0, 160)

    if (Array.isArray(record.options)) {
      field.options = record.options
        .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object')
        .slice(0, 200)
        .map((option) => ({
          value: nonEmptyString(option.value),
          label: nonEmptyString(option.label),
          ...(option.disabled === true ? { disabled: true } : {}),
        }))
        .filter((option) => option.value)
    }

    if (record.validation && typeof record.validation === 'object') {
      const validation = record.validation as Record<string, unknown>
      field.validation = {
        ...(typeof validation.min === 'number' ? { min: validation.min } : {}),
        ...(typeof validation.max === 'number' ? { max: validation.max } : {}),
        ...(typeof validation.minLength === 'number' ? { minLength: validation.minLength } : {}),
        ...(typeof validation.maxLength === 'number' ? { maxLength: validation.maxLength } : {}),
        ...(typeof validation.pattern === 'string' ? { pattern: validation.pattern.slice(0, 500) } : {}),
      }
    }

    out.push(field)
    if (out.length >= MAX_FIELDS) break
  }

  return out
}

export async function POST(request: NextRequest) {
  if (!resolveAiGatewayBaseUrl()) {
    return NextResponse.json(
      {
        error:
          'AI gateway is not configured for this deployment. Set LUMIERE_AI_GATEWAY_URL (server-side).',
      },
      { status: 503 },
    )
  }

  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgId = session.organizationId
  if (orgId === undefined || orgId <= 0) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'companyId must be a positive integer' }, { status: 400 })
  }

  const allowed = await companyIdBelongsToOrganization(session, companyId)
  if (!allowed) {
    return NextResponse.json({ error: 'Company does not belong to this organization' }, { status: 403 })
  }

  const formId = nonEmptyString(body.formId ?? body.form_id)
  const entityType = nonEmptyString(body.entityType ?? body.entity_type)
  const fields = sanitizeFields(body.fields)
  const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {}

  if (!formId) return NextResponse.json({ error: 'form_id is required' }, { status: 400 })
  if (!entityType) return NextResponse.json({ error: 'entity_type is required' }, { status: 400 })
  if (fields.length === 0) return NextResponse.json({ error: 'fields are required' }, { status: 400 })

  try {
    const gw = await fetchAiGateway('/v1/forms/validate', {
      method: 'POST',
      body: JSON.stringify({
        org_id: orgId,
        company_id: companyId,
        form_id: formId,
        entity_type: entityType,
        fields,
        values,
      }),
    })
    const payload = gw.text ? JSON.parse(gw.text) : {}
    return NextResponse.json(payload, { status: gw.ok ? 200 : gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
