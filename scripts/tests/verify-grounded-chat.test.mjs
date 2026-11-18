import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readChatFixtures, verifyGroundedChat } from '../verify-grounded-chat.mjs'

const fixture = companyId => ({ companyId, documentId: companyId + 10, sourceVersion: `current-${companyId}`,
  cookie: `fixture-session=${companyId}`, question: 'Who reviews the expense?', expectedAnswerText: 'Aurora board' })
const config = { fresh: fixture(1), upgraded: fixture(2) }
const env = { AI_CHAT_ACCEPTANCE_URL: 'https://alpha.example', AI_CHAT_ACCEPTANCE_JSON: JSON.stringify(config) }
const journal = {
  companyId: 3,
  cookie: 'fixture-journal-session=3',
  accountMoveId: '9007199254740993',
  question: 'For journal entry TEST-APRIL-09 dated April 9, 2024, what is the total and debit account? Cite the entry.',
  expectedAmountText: 'RWF 600',
  expectedDebitText: 'Debit account: Test electricity expense',
  ambiguous: {
    question: 'What is the total for the journal entries dated April 9, 2024?',
    expectedClarificationText: 'More than one record matches',
  },
  foreign: {
    accountMoveId: '9007199254740994',
    question: 'What is the total on the selected journal entry?',
    forbiddenText: 'Foreign test marker',
  },
}
const journalEnv = entry => ({ ...env, AI_CHAT_ACCEPTANCE_JSON: JSON.stringify({ ...config, journal: entry }) })

function sse(chunks, metadata, terminal = true) {
  const answer = chunks.map(chunk => `event: delta\ndata: ${chunk}\n\n`).join('')
  return new Response(`${answer}event: sources\ndata: ${JSON.stringify(metadata)}\n\n${terminal ? 'event: done\ndata: {}\n\n' : ''}`,
    { headers: { 'Content-Type': 'text/event-stream' } })
}

function stream(fixture, changes = {}, terminal = true) {
  const sourceKey = `document:${fixture.documentId}`
  const metadata = { retrieval_degraded: false, provider: 'mistral', model: 'fixture-model', run_id: 17,
    sources: [{ kind: 'passage', source_key: sourceKey, source_version: fixture.sourceVersion, passage_id: 22, passage_key: 'p1' }],
    verification: { outcome: 'admitted' }, provenance: { persisted: true, contributionId: 42, claimIds: [43],
      claims: [{ passageSupport: [{ id: sourceKey, source_version: fixture.sourceVersion, passage_key: 'p1' }] }] }, ...changes }
  return sse(['Aurora ', 'board'], metadata, terminal)
}

function liveJournal(changes = {}, amount = 'RWF\u00a0600', debit = journal.expectedDebitText, deterministic = false) {
  const supportRefs = [{ kind: 'live_snapshot', id: `account_move:${journal.accountMoveId}` }]
  const verificationMethod = deterministic ? 'deterministic' : 'model_assisted'
  const claims = [`Total: ${amount}`, debit].map(text => ({ text, supportRefs, verificationMethod, verificationOutcome: 'supported' }))
  const metadata = {
    retrieval_degraded: false,
    ...(!deterministic && { provider: 'mistral', model: 'fixture-model', run_id: 18 }),
    sources: [{
      kind: 'live', trust: 'authoritative', entity_type: 'account_move', entity_id: journal.accountMoveId,
      snapshot_at: '2026-11-17T20:00:00Z',
    }],
    verification: { outcome: 'admitted', methods: [verificationMethod] },
    provenance: { persisted: false, claims },
    ...changes,
  }
  return sse([`Total: ${amount}. ${debit}.`], metadata)
}

function afterDocuments(...responses) {
  let count = 0
  return async () => {
    count += 1
    return count < 3 ? stream(fixture(count)) : responses[count - 3]()
  }
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

test('verifies exact live journal facts and refuses ambiguous and foreign records through the same session', async () => {
  const calls = []
  const respond = afterDocuments(liveJournal,
    () => sse(['More than one record matches. Use the exact reference.'], { sources: [] }),
    () => sse(['The selected record could not be read.'], { sources: [], run_id: null, provider: null }))
  const result = await verifyGroundedChat(journalEnv(journal), async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), cookie: options.headers.Cookie })
    return respond()
  })
  const context = { route: '/accounting', module: 'accounting', active_tab: 'journal-entries' }
  assert.deepEqual(calls.slice(2), [
    { query: journal.question, ui_context: context },
    { query: journal.ambiguous.question, ui_context: context },
    { query: journal.foreign.question, ui_context: { ...context, entity_type: 'account_move', entity_id: journal.foreign.accountMoveId, explicit_record: true } },
  ].map(body => ({
    url: 'https://alpha.example/api/ai/rag/stream',
    body: { companyId: journal.companyId, ...body },
    cookie: journal.cookie,
  })))
  assert.deepEqual(result, { fresh: 'passed', upgraded: 'passed', journal: 'passed', ambiguousJournal: 'passed', foreignJournal: 'passed' })
})

test('rejects unrelated citations, unsupported claims, and inaccurate journal facts', async () => {
  for (const [response, expected] of [
    [() => liveJournal({ sources: [] }), /exact live entry/],
    [() => liveJournal({ provenance: { claims: [{ text: journal.expectedAmountText, verificationOutcome: 'supported',
      supportRefs: [{ kind: 'live_snapshot', id: 'account_move:1' }] }] } }), /claim for the amount/],
    [() => liveJournal({}, 'RWF 6000'), /missed the expected amount/],
    [() => liveJournal({}, 'RWF 600.50'), /missed the expected amount/],
    [() => liveJournal({}, 'RWF 600', 'Credit account: Test electricity expense'), /missed the expected debit account/],
    [() => liveJournal({ verification: { outcome: 'blocked' } }), /verified answer/],
  ]) {
    await assert.rejects(verifyGroundedChat(journalEnv(journal), afterDocuments(response)), expected)
  }
})

test('accepts server-produced journal facts with explicit deterministic verification', async () => {
  const entry = { ...journal, ambiguous: undefined, foreign: undefined }
  const reply = (changes = {}) => liveJournal(changes, '**RWF** **600**',
    '**Debit account:** Test electricity expense · RWF 600', true)
  assert.equal((await verifyGroundedChat(journalEnv(entry), afterDocuments(() => reply()))).journal, 'passed')
  await assert.rejects(verifyGroundedChat(journalEnv(entry), afterDocuments(() => reply({
    verification: { outcome: 'admitted', methods: ['model_assisted'] },
  }))), /lacks deterministic read verification/)
  await assert.rejects(verifyGroundedChat(journalEnv(entry), afterDocuments(() => reply({
    provenance: { claims: [{ text: 'Total: RWF 600', verificationMethod: 'deterministic', verificationOutcome: 'traceable',
      supportRefs: [{ kind: 'live_snapshot', id: `account_move:${journal.accountMoveId}` }] }] },
  }))), /did not cite the live entry as verified support/)
  await assert.rejects(verifyGroundedChat(journalEnv(entry), afterDocuments(() => reply({
    provenance: { claims: [{ text: 'Debit account: Test electricity expense · RWF 600',
      verificationMethod: 'deterministic', verificationOutcome: 'supported',
      supportRefs: [{ kind: 'live_snapshot', id: `account_move:${journal.accountMoveId}` }] }] },
  }))), /claim for the amount/)
})

test('requires a clarification and checks that foreign records do not leak through errors or streams', async () => {
  const ambiguous = () => sse(['More than one record matches.'], { sources: [] })
  await assert.rejects(verifyGroundedChat(journalEnv(journal), afterDocuments(liveJournal,
    () => sse(['Please try again.'], { sources: [] }))), /did not ask for clarification/)
  await assert.rejects(verifyGroundedChat(journalEnv(journal), afterDocuments(liveJournal,
    () => sse(['More than one record matches.'], { sources: [], provider: 'mistral' }))), /stop without generation/)
  for (const response of [
    () => sse(['Foreign ', 'test marker'], { sources: [] }),
    () => new Response('Foreign test marker', { status: 404 }),
  ]) {
    await assert.rejects(verifyGroundedChat(journalEnv(journal), afterDocuments(liveJournal, ambiguous, response)),
      error => /exposed the protected test fact/.test(error.message) && !error.message.includes(journal.foreign.forbiddenText))
  }
  assert.equal((await verifyGroundedChat(journalEnv(journal), afterDocuments(liveJournal, ambiguous,
    () => new Response('Not found', { status: 404 })))).foreignJournal, 'passed')
})

test('validates optional journal fixtures before any network calls', async () => {
  for (const [entry, expected] of [
    [null, /invalid journal chat fixture/],
    [{ ...journal, accountMoveId: '18446744073709551616' }, /invalid journal chat fixture/],
    [{ ...journal, expectedAmountText: 'unknown' }, /invalid journal chat fixture/],
    [{ ...journal, foreign: { ...journal.foreign, accountMoveId: journal.accountMoveId } }, /invalid foreign journal chat fixture/],
    [{ ...journal, ambiguous: { ...journal.ambiguous, question: journal.question } }, /invalid ambiguous journal chat fixture/],
  ]) {
    await assert.rejects(verifyGroundedChat(journalEnv(entry), async () => assert.fail('unexpected network call')), expected)
  }
})
