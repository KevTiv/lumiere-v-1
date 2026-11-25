import { NextResponse, type NextRequest } from 'next/server'

import { fetchAiGatewayResponse } from '@/lib/ai-gateway-server'
import { resolveAiPrivacyPolicy } from '../../_lib/ai-privacy-policy'
import { parseJsonBody, requireAiRouteContext, validateCompanyScope } from '../../_lib/route-helpers'
import { localRunnerOperation } from '../contract'

const noStore = { 'Cache-Control': 'no-store' }
const exposedStatuses = new Set([400, 401, 403, 404, 409, 410, 422, 429, 503])

function reject(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStore })
}

function protect(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

async function forward(request: NextRequest, method: 'GET' | 'POST', segments: string[]) {
  const auth = await requireAiRouteContext(request)
  if (!auth.ok) return protect(auth.response)
  const { session, orgId } = auth.context
  if (!session.identityHex || session.identityHex === 'unknown' || !session.stdbToken.trim()) {
    return reject('Authenticated actor context required', 403)
  }
  if (!process.env.LUMIERE_AI_GATEWAY_INTERNAL_SECRET?.trim()) {
    return reject('Local runner service unavailable', 503)
  }
  const requestType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (method === 'POST' && requestType !== 'application/json') {
    return reject('Expected JSON runner intent', 415)
  }

  const input = method === 'POST'
    ? await parseJsonBody(request)
    : { ok: true as const, body: Object.fromEntries(request.nextUrl.searchParams) }
  if (!input.ok) return protect(input.response)
  const operation = localRunnerOperation(method, segments, input.body)
  if (!operation) return reject('Invalid local runner request', 400)

  const companyError = await validateCompanyScope(session, operation.companyId)
  if (companyError) return protect(companyError)

  try {
    const expected = operation.stream ? 'text/event-stream' : 'application/json'
    const body = operation.path === 'runs' && method === 'POST'
      ? { ...operation.body, orgPrivacyPolicy: resolveAiPrivacyPolicy(session.fieldAccess) }
      : operation.body
    const gateway = await fetchAiGatewayResponse(`/v1/internal/local-runner/${operation.path}`, {
      method,
      headers: {
        Accept: expected,
        'x-lumiere-organization-id': String(orgId),
        'x-lumiere-company-id': String(operation.companyId),
        'x-lumiere-actor-identity': session.identityHex,
        'x-lumiere-actor-token': session.stdbToken,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: request.signal,
    })
    if (!gateway.ok) {
      await gateway.body?.cancel().catch(() => undefined)
      const status = exposedStatuses.has(gateway.status) ? gateway.status : 503
      return reject(status === 403 ? 'Local runner operation is not permitted' : 'Local runner operation failed', status)
    }
    if (gateway.status === 204 && !operation.stream) return new Response(null, { status: 204, headers: noStore })
    const contentType = gateway.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (!gateway.body || contentType !== expected) {
      await gateway.body?.cancel().catch(() => undefined)
      return reject('Local runner service unavailable', 503)
    }
    return new Response(gateway.body, {
      status: gateway.status,
      headers: { ...noStore, 'Content-Type': expected, ...(operation.stream && { 'X-Accel-Buffering': 'no' }) },
    })
  } catch {
    return reject('Local runner service unavailable', 503)
  }
}

type Context = { params: Promise<{ operation: string[] }> }

export async function GET(request: NextRequest, context: Context) {
  return forward(request, 'GET', (await context.params).operation)
}

export async function POST(request: NextRequest, context: Context) {
  return forward(request, 'POST', (await context.params).operation)
}
