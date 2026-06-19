import { type NextRequest, NextResponse } from 'next/server'

import { fetchAiGateway, resolveAiGatewayBaseUrl } from '@/lib/ai-gateway-server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { companyIdBelongsToOrganization } from '@/lib/company-scope-server'

export type JsonObject = Record<string, unknown>

export interface AiRouteContext {
  session: ApiSession
  orgId: number
}

const GATEWAY_UNCONFIGURED =
  'AI gateway is not configured for this deployment. Set LUMIERE_AI_GATEWAY_URL (server-side).'

export function aiGatewayUnavailableResponse() {
  return NextResponse.json({ error: GATEWAY_UNCONFIGURED }, { status: 503 })
}

export async function requireAiRouteContext(request: NextRequest): Promise<
  | { ok: true; context: AiRouteContext }
  | { ok: false; response: NextResponse }
> {
  if (!resolveAiGatewayBaseUrl()) {
    return { ok: false, response: aiGatewayUnavailableResponse() }
  }

  const session = await resolveApiSession(request)
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const orgId = session.organizationId
  if (orgId === undefined || orgId <= 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Organization context required' }, { status: 403 }),
    }
  }

  return { ok: true, context: { session, orgId } }
}

export async function parseJsonBody(request: NextRequest): Promise<
  | { ok: true; body: JsonObject }
  | { ok: false; response: NextResponse }
> {
  try {
    const body = (await request.json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: NextResponse.json({ error: 'JSON object body required' }, { status: 400 }) }
    }
    return { ok: true, body: body as JsonObject }
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }
}

export function positiveInteger(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return NaN
}

export function optionalPositiveInteger(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = positiveInteger(raw)
  return Number.isFinite(value) && value > 0 ? value : NaN
}

export async function validateCompanyScope(
  session: ApiSession,
  companyId: number,
): Promise<NextResponse | null> {
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'companyId must be a positive integer' }, { status: 400 })
  }

  const allowed = await companyIdBelongsToOrganization(session, companyId)
  if (!allowed) {
    return NextResponse.json({ error: 'Company does not belong to this organization' }, { status: 403 })
  }

  return null
}

export function boundedString(raw: unknown, maxLength: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, maxLength) : ''
}

export function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  let value = fallback
  if (typeof raw === 'number' && Number.isFinite(raw)) value = Math.floor(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) value = parsed
  }
  return Math.min(max, Math.max(min, value))
}

export function boundedNumber(
  raw: unknown,
  fallback: number | undefined,
  min: number,
  max: number,
): number | undefined {
  let value = fallback
  if (typeof raw === 'number' && Number.isFinite(raw)) value = raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) value = parsed
  }
  return value === undefined ? undefined : Math.min(max, Math.max(min, value))
}

export function sanitizeIdentifier(raw: unknown, maxLength = 120): string {
  return boundedString(raw, maxLength).replace(/[^\w.:-]/g, '')
}

export function sanitizeStringList(raw: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const value = boundedString(item, maxLength)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= maxItems) break
  }

  return out.length > 0 ? out : undefined
}

export function sanitizeJsonValue(raw: unknown, depth = 0): unknown {
  if (raw === null || typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'string') return raw.slice(0, 2_000)
  if (depth >= 4) return undefined

  if (Array.isArray(raw)) {
    return raw.slice(0, 100).map((item) => sanitizeJsonValue(item, depth + 1))
  }

  if (raw && typeof raw === 'object') {
    const out: JsonObject = {}
    for (const [key, value] of Object.entries(raw as JsonObject).slice(0, 100)) {
      const safeKey = sanitizeIdentifier(key, 120)
      if (!safeKey) continue
      const safeValue = sanitizeJsonValue(value, depth + 1)
      if (safeValue !== undefined) out[safeKey] = safeValue
    }
    return out
  }

  return undefined
}

export function sanitizeRecord(raw: unknown): JsonObject | undefined {
  const safe = sanitizeJsonValue(raw)
  return safe && typeof safe === 'object' && !Array.isArray(safe) ? (safe as JsonObject) : undefined
}

export async function proxyAiGateway(path: string, payload: JsonObject) {
  try {
    const gw = await fetchAiGateway(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const responsePayload = gw.text
      ? (() => {
          try {
            return JSON.parse(gw.text) as JsonObject
          } catch {
            return { error: gw.text }
          }
        })()
      : {}
    return NextResponse.json(responsePayload, { status: gw.status })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'AI gateway request failed', detail }, { status: 502 })
  }
}
