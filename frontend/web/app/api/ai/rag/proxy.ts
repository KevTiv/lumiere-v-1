import { type NextRequest, NextResponse } from 'next/server'
import { fetchAiGatewayResponse } from '@/lib/ai-gateway-server'
import { parseRagRequest, prepareRagPayload } from '../_lib/rag-request'
import { requireAiRouteContext } from '../_lib/route-helpers'

const REQUEST_ID = 'x-lumiere-ai-request-id'

export async function proxyRag(
  request: NextRequest,
  transport: 'json' | 'sse',
) {
  const requestId = crypto.randomUUID()
  const started = Date.now()
  const headers = {
    [REQUEST_ID]: requestId,
    'Cache-Control': 'no-store, no-transform',
  }
  let orgId: number | undefined
  let companyId: number | undefined
  let stage = 'session'

  const report = (event: string, status?: number) => {
    const log =
      status !== undefined && status >= 400 ? console.warn : console.info
    log('[ai.chat]', {
      event,
      requestId,
      orgId,
      companyId,
      transport,
      status,
      durationMs: Date.now() - started,
    })
  }

  const reject = (response: Response) => {
    report(stage, response.status)
    response.headers.set(REQUEST_ID, requestId)
    return response
  }

  try {
    const context = await requireAiRouteContext(request)
    if (!context.ok) return reject(context.response)
    orgId = context.context.orgId

    stage = 'request_validation'
    const body = await parseRagRequest(request)
    if (!body.ok) return reject(body.response)
    stage = 'company_and_context'
    const rag = await prepareRagPayload({ body: body.body, ...context.context })
    if (!rag.ok) return reject(rag.response)
    companyId = rag.payload.company_id

    stage = 'gateway_request'
    report('dispatch')
    const expected =
      transport === 'sse' ? 'text/event-stream' : 'application/json'
    const gateway = await fetchAiGatewayResponse(
      transport === 'sse' ? '/v1/rag/stream' : '/v1/rag',
      {
        method: 'POST',
        headers: { [REQUEST_ID]: requestId, Accept: expected },
        body: JSON.stringify(rag.payload),
        signal: request.signal,
      },
    )
    const contentType = gateway.headers.get('content-type') ?? ''
    const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
    if (!gateway.ok) {
      report('gateway_rejected', gateway.status)
      if (gateway.body && mediaType === 'application/json') {
        return new Response(gateway.body, {
          status: gateway.status,
          headers: { ...headers, 'Content-Type': contentType },
        })
      }
      await gateway.body?.cancel().catch(() => undefined)
      return NextResponse.json(
        { error: 'AI gateway rejected the request' },
        { status: gateway.status, headers },
      )
    }
    if (!gateway.body || mediaType !== expected) {
      await gateway.body?.cancel().catch(() => undefined)
      report('unexpected_gateway_response', 502)
      return NextResponse.json(
        { error: 'AI gateway returned an invalid response' },
        { status: 502, headers },
      )
    }
    report('response_headers', gateway.status)
    return new Response(gateway.body, {
      status: gateway.status,
      headers: { ...headers, 'Content-Type': contentType },
    })
  } catch {
    report(request.signal.aborted ? 'request_aborted' : stage, 502)
    return NextResponse.json(
      { error: 'AI gateway request failed' },
      { status: 502, headers },
    )
  }
}
