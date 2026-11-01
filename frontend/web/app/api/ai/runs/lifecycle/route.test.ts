import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildGatewayLifecycleRequest, parseLifecycleBrowserBody } from './contract'

const compiled = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const continuation = { runId: 7, checkpointHash: 'a'.repeat(64), cursor: 4, concurrencyVersion: 2 }

type Forwarded = { path: string; init: { method: string; headers: unknown; body: string } }
function lifecycleRoute(options: {
  denied?: boolean; companyDenied?: boolean; actor?: string; token?: string;
  missingSecret?: boolean; gatewayStatus?: number; gatewayThrows?: boolean;
} = {}) {
  const calls: Forwarded[] = []
  const session = { identityHex: options.actor ?? 'a'.repeat(64), stdbToken: options.token ?? 'actor-token' }
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    '../../_lib/route-helpers': {
      requireAiRouteContext: async () => options.denied
        ? { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
        : { ok: true, context: { session, orgId: 11 } },
      parseJsonBody: async (request: Request) => ({ ok: true, body: await request.json() }),
      validateCompanyScope: async () => options.companyDenied
        ? Response.json({ error: 'Forbidden' }, { status: 403 }) : null,
    },
    './contract': { buildGatewayLifecycleRequest, parseLifecycleBrowserBody },
    '@/lib/ai-gateway-server': {
      fetchAiGateway: async (path: string, init: Forwarded['init']) => {
        calls.push({ path, init })
        if (options.gatewayThrows) throw new Error('private upstream failure')
        return { ok: !options.gatewayStatus, status: options.gatewayStatus ?? 200,
          text: JSON.stringify(options.gatewayStatus ? { error: 'private upstream detail' } : { runId: 7, state: 'waiting_input' }) }
      },
    },
  }
  const module = { exports: {} as { POST: (request: Request) => Promise<Response> } }
  runInNewContext(compiled, {
    module, exports: module.exports,
    process: { env: { LUMIERE_AI_GATEWAY_INTERNAL_SECRET: options.missingSecret ? '' : 'configured' } },
    require: (id: string) => { assert.ok(id in dependencies, `unexpected dependency ${id}`); return dependencies[id] },
  })
  return { calls, submit: (body: unknown = { companyId: 13, intent: { kind: 'inspect', runId: 7 } }) => module.exports.POST(new Request('https://web.test/api/ai/runs/lifecycle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })) }
}

test('the admitted lifecycle route forwards only session authority and exact scoped run intent', async () => {
  for (const intent of [{ kind: 'inspect', runId: 7 }, { kind: 'resume', continuation, idempotencyKey: 'resume-1' }]) {
    const route = lifecycleRoute()
    const response = await route.submit({ companyId: 13, intent })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(route.calls.length, 1)
    assert.equal(route.calls[0].path, '/v1/internal/harness/runs/lifecycle')
    assert.equal(route.calls[0].init.method, 'POST')
    assert.deepEqual(route.calls[0].init.headers, {
      'x-lumiere-organization-id': '11', 'x-lumiere-company-id': '13',
      'x-lumiere-actor-identity': 'a'.repeat(64), 'x-lumiere-actor-token': 'actor-token',
    })
    assert.equal(JSON.parse(route.calls[0].init.body).runId, 7)
    assert.equal(JSON.parse(route.calls[0].init.body).intent.kind, intent.kind === 'inspect' ? 'view' : 'resume')
  }
})

test('missing session, actor, company permission or service configuration cannot dispatch', async () => {
  for (const [options, expected] of [
    [{ denied: true }, 401], [{ actor: 'unknown' }, 403], [{ actor: '' }, 403],
    [{ token: '' }, 403], [{ companyDenied: true }, 403], [{ missingSecret: true }, 503],
  ] as const) {
    const route = lifecycleRoute(options)
    const response = await route.submit()
    assert.equal(response.status, expected)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(route.calls.length, 0)
  }
})

test('browser-supplied authority and malformed continuations cannot reach the gateway', async () => {
  for (const body of [
    { companyId: 13, organizationId: 99, intent: { kind: 'inspect', runId: 7 } },
    { companyId: 13, actorIdentity: 'forged', intent: { kind: 'inspect', runId: 7 } },
    { companyId: 13, stdbToken: 'forged', intent: { kind: 'inspect', runId: 7 } },
    { companyId: 13, intent: { kind: 'resume', continuation: { ...continuation, checkpointHash: 'forged' }, idempotencyKey: 'resume-1' } },
  ]) {
    const route = lifecycleRoute()
    assert.equal((await route.submit(body)).status, 400)
    assert.equal(route.calls.length, 0)
  }
})

test('current authorization denial and stale continuation stay failures without retry or private details', async () => {
  for (const status of [400, 403, 404, 409, 422, 500]) {
    const route = lifecycleRoute({ gatewayStatus: status })
    const response = await route.submit({ companyId: 13, intent: { kind: 'resume', continuation, idempotencyKey: 'resume-1' } })
    assert.equal(response.status, status === 500 ? 503 : status)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.doesNotMatch(await response.text(), /private upstream detail/)
    assert.equal(route.calls.length, 1)
  }
})

test('an uncertain gateway reply is not retried by the lifecycle BFF', async () => {
  const route = lifecycleRoute({ gatewayThrows: true })
  const response = await route.submit({ companyId: 13, intent: { kind: 'interrupt', continuation, reason: 'stop', idempotencyKey: 'interrupt-1' } })
  assert.equal(response.status, 503)
  assert.doesNotMatch(await response.text(), /private upstream failure/)
  assert.equal(route.calls.length, 1)
})
