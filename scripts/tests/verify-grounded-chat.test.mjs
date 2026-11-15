import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readChatFixtures, verifyGroundedChat } from '../verify-grounded-chat.mjs'

const fixture = companyId => ({ companyId, documentId: companyId + 10, sourceVersion: `current-${companyId}`,
  cookie: `fixture-session=${companyId}`, question: 'Who reviews the expense?', expectedAnswerText: 'Aurora board' })
const config = { fresh: fixture(1), upgraded: fixture(2) }
const env = { AI_CHAT_ACCEPTANCE_URL: 'https://alpha.example', AI_CHAT_ACCEPTANCE_JSON: JSON.stringify(config) }

function stream(fixture, changes = {}, terminal = true) {
  const sourceKey = `document:${fixture.documentId}`
  const metadata = { retrieval_degraded: false, provider: 'mistral', model: 'fixture-model', run_id: 17,
    sources: [{ kind: 'passage', source_key: sourceKey, source_version: fixture.sourceVersion, passage_id: 22, passage_key: 'p1' }],
    verification: { outcome: 'admitted' }, provenance: { persisted: true, contributionId: 42, claimIds: [43],
      claims: [{ passageSupport: [{ id: sourceKey, source_version: fixture.sourceVersion, passage_key: 'p1' }] }] }, ...changes }
  return new Response(`event: delta\ndata: Aurora \n\nevent: delta\ndata: board\n\nevent: sources\ndata: ${JSON.stringify(metadata)}\n\n${terminal ? 'event: done\ndata: {}\n\n' : ''}`,
    { headers: { 'Content-Type': 'text/event-stream' } })
}

test('checks a completed, claim-grounded reply through the signed-in streaming route for each cohort', async () => {
  const calls = []
  const result = await verifyGroundedChat(env, async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push([url, body.companyId, options.headers.Cookie, options.redirect])
    assert.deepEqual(body, { companyId: body.companyId, query: fixture(body.companyId).question })
    return stream(fixture(body.companyId))
  })
  assert.deepEqual(calls, [1, 2].map(id => ['https://alpha.example/api/ai/rag/stream', id, fixture(id).cookie, 'error']))
  assert.deepEqual(result, { fresh: 'passed', upgraded: 'passed' })
})

test('fails on false success, including healthy but empty output, stale citations and truncated streams', async () => {
  for (const [response, expected] of [
    [() => stream(fixture(2), { retrieval_degraded: true }), /healthy retrieval/],
    [() => stream(fixture(2), { provider: null }), /completed provider response/],
    [() => stream(fixture(2), { verification: { outcome: 'withheld' } }), /verified answer/],
    [() => stream(fixture(2), { sources: [] }), /expected source version/],
    [() => stream({ ...fixture(2), sourceVersion: 'stale' }), /expected source version/],
    [() => stream(fixture(2), {}, false), /stream did not complete/],
    [() => new Response('private response content', { status: 503 }), /HTTP 503/],
    [() => new Response('sign in'), /did not return an event stream/],
  ]) {
    let calls = 0
    await assert.rejects(verifyGroundedChat(env, async () => ++calls === 1 ? stream(fixture(1)) : response()),
      error => expected.test(error.message) && error.message.startsWith('upgraded') && !error.message.includes('private response content'))
    assert.equal(calls, 2)
  }
})

test('fails before network calls when the origin, account scope, or cookie is malformed', () => {
  assert.throws(() => readChatFixtures({ ...env, AI_CHAT_ACCEPTANCE_URL: 'http://alpha.example' }), /HTTPS origin/)
  assert.throws(() => readChatFixtures({ ...env, AI_CHAT_ACCEPTANCE_JSON: JSON.stringify({ fresh: fixture(1), upgraded: fixture(1) }) }), /different companies/)
  assert.throws(() => readChatFixtures({ ...env, AI_CHAT_ACCEPTANCE_JSON: JSON.stringify({ ...config, upgraded: { ...fixture(2), cookie: 'invalid\nheader' } }) }), /invalid upgraded chat fixture/)
})
