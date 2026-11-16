import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { authorizationRequest, exchange, ISSUER, parseCallback, RESOURCE } from './oauth.mjs'
import { availableModel, parseResponsesStream, runSmoke } from './responses.mjs'

const REDIRECT = 'http://127.0.0.1:1455/auth/callback'
const HOST_ID = 'urn:uuid:46576efe-52e6-42eb-86cb-485e2bad4a98'
const REGISTRATION = { clientId: 'oaiapp_fixture', subject: 'account_fixture' }

async function mockOAuth(attempt, changes = {}, { scopes = 'chatgpt.tokens.use.direct openid' } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'fixture' }] })
  const idToken = await new SignJWT({
    iss: ISSUER,
    aud: REGISTRATION.clientId,
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: REGISTRATION.subject,
    nonce: attempt.nonce,
    ...changes,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .sign(privateKey)
  const fetcher = async (url, options) => {
    assert.equal(url, ISSUER + '/api/accounts/oauth/token')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(Object.fromEntries(options.body), {
      grant_type: 'authorization_code',
      client_id: REGISTRATION.clientId,
      code: 'fixture_code',
      code_verifier: attempt.verifier,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    })
    return Response.json({
      id_token: idToken,
      access_token: 'fixture_access',
      refresh_token: 'unused_refresh',
      scope: scopes,
      token_type: 'Bearer',
    })
  }
  return { idToken, jwks, fetcher }
}

function callback(attempt, fields = { code: 'fixture_code', client_id: REGISTRATION.clientId }) {
  return parseCallback(
    new URL(REDIRECT + '?' + new URLSearchParams({ state: attempt.state, ...fields })),
    attempt,
  )
}

test('dynamic OAuth uses PKCE and validates the issued identity and plan scope', async () => {
  const attempt = authorizationRequest(HOST_ID, REDIRECT)
  const params = attempt.url.searchParams
  assert.equal(params.get('client_id'), 'dynamic_agent_client')
  assert.equal(params.get('agent_name_hint'), 'Lumière')
  assert.equal(params.get('ext_agent_host_id'), HOST_ID)
  assert.equal(params.get('redirect_uri'), REDIRECT)
  assert.equal(params.get('code_challenge_method'), 'S256')
  assert.equal(
    params.get('code_challenge'),
    createHash('sha256').update(attempt.verifier).digest('base64url'),
  )
  assert.notEqual(attempt.nonce, attempt.state)
  assert.throws(
    () => callback(attempt, { code: 'fixture_code', state: 'other', client_id: REGISTRATION.clientId }),
    /state/,
  )
  assert.throws(() => callback(attempt, { error: 'access_denied' }), /declined/)
  const { jwks, fetcher } = await mockOAuth(attempt)
  assert.deepEqual(await exchange(attempt, callback(attempt), jwks, fetcher), {
    accessToken: 'fixture_access',
    registration: REGISTRATION,
  })
})

test('reauthorization rejects callback substitution, mismatched signed identity, and declined plan usage', async () => {
  const attempt = authorizationRequest(HOST_ID, REDIRECT, REGISTRATION)
  assert.equal(attempt.url.searchParams.get('client_id'), REGISTRATION.clientId)
  assert.equal(attempt.url.searchParams.get('agent_name_hint'), null)
  assert.throws(() => callback(attempt, { code: 'fixture_code', client_id: 'app_other' }), /registration/)
  const returning = callback(attempt, { code: 'fixture_code' })
  for (const [claims, settings, message] of [
    [{ nonce: 'unexpected' }, {}, /identity did not match/],
    [{ sub: 'different_user' }, {}, /identity did not match/],
    [{ aud: 'different_app' }, {}, /token verification/],
    [{ exp: 100 }, {}, /token verification/],
    [{}, { scopes: 'openid' }, /permission was declined/],
  ]) {
    const { jwks, fetcher } = await mockOAuth(attempt, claims, settings)
    await assert.rejects(exchange(attempt, returning, jwks, fetcher), message)
  }
})

function streamEvent(type, fields = {}) {
  return 'event: ' + type + '\r\ndata: ' + JSON.stringify({ type, ...fields }) + '\r\n\r\n'
}

function streamingResponse(...frames) {
  const bytes = new TextEncoder().encode(frames.join(''))
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) {
          controller.enqueue(bytes.slice(offset, offset + 3))
        }
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

const responseOutput = (output) =>
  streamingResponse(streamEvent('response.completed', { response: { output } }))
const assistant = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })

test('an authenticated plan resolves an account-visible model and one read-only local tool', async () => {
  const call = {
    type: 'function_call',
    namespace: 'inventory',
    name: 'has_products',
    call_id: 'call_fixture',
    arguments: '{}',
  }
  const reasoning = { type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'encrypted' }
  const accessToken = 'fixture_access'
  const erp = { port: 8082, organizationId: '4097', token: 'erp-user-token' }
  const queue = ['model', 'tool-call', 'erp-read', 'final']
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error')
    const stage = queue.shift()
    if (stage === 'erp-read') {
      assert.equal(String(url), 'http://127.0.0.1:8082/v1/query/products?organizationId=4097&limit=1')
      assert.equal(options.method, undefined)
      assert.equal(options.headers.Authorization, 'Bearer ' + erp.token)
      return Response.json({ data: [{ name: 'Private product name', cost: 24 }] })
    }
    assert.equal(options.headers.Authorization, 'Bearer ' + accessToken)
    if (stage === 'model') {
      assert.equal(url, RESOURCE + '/models')
      return Response.json({
        models: [
          { slug: 'hidden', visibility: 'hidden' },
          { slug: 'gpt-fixture', visibility: 'list' },
        ],
      })
    }
    assert.equal(url, RESOURCE + '/responses')
    assert.equal(options.method, 'POST')
    assert.ok(!options.body.includes(erp.token) && !options.body.includes('Private product name'))
    const body = JSON.parse(options.body)
    assert.equal(body.stream, true)
    assert.equal(body.store, false)
    assert.equal(body.model, 'gpt-fixture')
    if (stage === 'tool-call') {
      assert.equal(body.tool_choice, 'required')
      assert.equal(body.tools[0].name, 'inventory')
      assert.deepEqual(body.include, ['reasoning.encrypted_content'])
      return responseOutput([reasoning, call])
    }
    assert.equal(stage, 'final')
    assert.equal(body.tool_choice, 'none')
    assert.deepEqual(body.input.slice(-3), [
      reasoning,
      call,
      { type: 'function_call_output', call_id: call.call_id, output: '{"hasVisibleProducts":true}' },
    ])
    return responseOutput([assistant('Oui, des produits sont visibles dans Lumière.')])
  }
  const model = await availableModel(accessToken, undefined, fetcher)
  assert.equal(
    await runSmoke({ accessToken, model, erp }, fetcher),
    'Oui, des produits sont visibles dans Lumière.',
  )
  assert.deepEqual(queue, [])
})

test('unexpected function call does not reach the local ERP API', async () => {
  let requests = 0
  const fetcher = async () => {
    requests += 1
    return responseOutput([{ type: 'function_call', name: 'unapproved', arguments: '{}' }])
  }
  await assert.rejects(
    runSmoke({ accessToken: 'fixture', model: 'model', erp: {} }, fetcher),
    /expected read-only/,
  )
  assert.equal(requests, 1)
})

test('an unreadable tool turn or denied ERP read never returns a tool result to OpenAI', async () => {
  const call = {
    type: 'function_call',
    namespace: 'inventory',
    name: 'has_products',
    call_id: 'call_fixture',
    arguments: '{}',
  }
  for (const extraOutput of [[{ type: 'reasoning', id: 'rs_without_state' }], []]) {
    const erp = { port: 8082, organizationId: '42', token: 'fixture' }
    let requests = 0
    const respond = async () => {
      requests += 1
      return requests === 1 ? responseOutput([...extraOutput, call]) : new Response(null, { status: 403 })
    }
    await assert.rejects(
      runSmoke({ accessToken: 'fixture', model: 'model', erp }, respond),
      extraOutput.length ? /replayable tool turn/ : /product query failed \(403\)/,
    )
    assert.equal(requests, extraOutput.length ? 1 : 2)
  }
})

test('partial stream and a usage limit after start produce no answer', async () => {
  const delta = streamEvent('response.output_text.delta', { delta: 'Partial answer' })
  await assert.rejects(parseResponsesStream(streamingResponse(delta).body), /ended before completion/)
  const limit = streamEvent('response.failed', {
    response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private message' } },
  })
  await assert.rejects(parseResponsesStream(streamingResponse(delta, limit).body), /reached its usage limit/)
})
