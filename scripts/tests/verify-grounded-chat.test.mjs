import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preflightSessions, readChatFixtures, runAcceptanceCheck, verifyGroundedChat } from '../verify-grounded-chat.mjs'

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

const scenarioBase = companyId => ({ companyId, cookie: `scenario-session=${companyId}` })
const record = { entityType: 'customer', entityId: '9007199254740995' }
const scenarios = {
  namedRecord: { ...scenarioBase(4), question: 'What is the credit limit of Aurora Farms?', ...record, expectedText: 'RWF 5,000' },
  followUp: { ...scenarioBase(4), chatSessionKey: 'acceptance-follow-up', first: { question: 'Open Aurora Farms', ...record },
    question: 'And what is its credit limit?', expectedText: 'RWF 5,000' },
  nonEnglish: { fr: { ...scenarioBase(4), question: 'Quelle est la limite de crédit ?', ...record, expectedText: 'RWF 5 000' },
    rw: { ...scenarioBase(4), question: 'Umwenda ntarengwa ni uwuhe?', ...record, expectedText: 'RWF 5 000' } },
  emptyCompany: { ...scenarioBase(5), question: 'What is our refund policy?', expectedText: 'not indexed yet' },
  summaryHandoff: { ...scenarioBase(4), question: 'Summarize this customer', capabilityKey: 'sales.summary.handoff' },
  revoked: { ...scenarioBase(4), question: 'What is the credit limit?', ...record, forbiddenText: 'Revoked marker',
    uiContext: { route: '/sales', module: 'sales' } },
  importContinuation: { ...scenarioBase(4), question: 'Continue the import', importTaskRefs: ['a'.repeat(32)],
    expectedRecords: [record], expectedText: 'reviewed' },
}
const scenarioEnv = (changes, extra) => ({ ...env, AI_CHAT_ACCEPTANCE_JSON: JSON.stringify({ ...config, ...extra, ...changes }) })

function liveRecord(answer, changes = {}) {
  return sse([answer], { retrieval_degraded: false, provider: 'mistral', model: 'fixture-model', run_id: 30,
    sources: [{ kind: 'live', entity_type: record.entityType, entity_id: record.entityId, snapshot_at: '2026-11-17T20:00:00Z' }],
    verification: { outcome: 'admitted' }, earlier_context_unavailable: false, ...changes })
}
const noIndex = () => sse(['Nothing is not indexed yet for this company.'], { retrieval_degraded: false, sources: [] })

function scenarioFetch(handlers) {
  const calls = []
  let count = 0
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push(body)
    count += 1
    if (count <= 2) return stream(fixture(count))
    return handlers[count - 3](body)
  }
  return { fetcher, calls }
}

test('runs each scenario with its session key, language, import refs and record context', async () => {
  const { fetcher, calls } = scenarioFetch([
    () => liveRecord('The limit is RWF 5,000.'),
    () => liveRecord('Aurora Farms'),
    () => liveRecord('The limit is RWF 5,000.'),
    () => liveRecord('La limite est RWF 5 000.'),
    () => liveRecord('Umwenda ni RWF 5 000.'),
    noIndex,
    () => liveRecord('Summary', { ui_actions: [{ capability_key: 'sales.summary.handoff' }] }),
    () => sse(['Not found'], { sources: [] }),
    () => liveRecord('Import reviewed.', { import_task_statuses: [{ taskId: 'a'.repeat(32) }] }),
  ])
  const result = await verifyGroundedChat(scenarioEnv(scenarios), fetcher)
  assert.deepEqual(result, { fresh: 'passed', upgraded: 'passed', namedRecord: 'passed', followUp: 'passed', nonEnglishFr: 'passed',
    nonEnglishRw: 'passed', emptyCompany: 'passed', summaryHandoff: 'passed', revoked: 'passed', importContinuation: 'passed' })
  const [named, first, second] = calls.slice(2, 5)
  assert.equal(named.chat_session_key, undefined)
  assert.equal(first.chat_session_key, second.chat_session_key)
  assert.match(first.chat_session_key, /^acceptance-follow-up-[a-z0-9]+$/)
  assert.deepEqual(calls[9].ui_context, { route: '/sales', module: 'sales', entity_type: 'customer', entity_id: record.entityId, explicit_record: true })
  assert.deepEqual(calls[10].import_task_refs, [{ taskId: 'a'.repeat(32), companyId: '4' }])
})

test('fails scenarios on missing sources, a lost follow-up, unindexed replies, handoffs and import records', async () => {
  const only = (name, handlers) => verifyGroundedChat(scenarioEnv({}, { [name]: scenarios[name] }), scenarioFetch(handlers).fetcher)
  await assert.rejects(only('namedRecord', [() => liveRecord('RWF 5,000', { sources: [] })]), /did not cite the expected record/)
  await assert.rejects(only('namedRecord', [() => liveRecord('RWF 5,000', { run_id: null })]), /completed provider response/)
  await assert.rejects(only('namedRecord', [() => liveRecord('RWF 5,000', { verification: { outcome: 'blocked' } })]), /verified answer/)
  await assert.rejects(only('followUp', [() => liveRecord('Aurora'), () => liveRecord('RWF 5,000', { sources: [] })]), /follow-up chat: .*expected record/)
  await assert.rejects(only('followUp', [() => liveRecord('Aurora'), () => liveRecord('RWF 5,000', { earlier_context_unavailable: true })]), /lost the earlier conversation/)
  await assert.rejects(only('emptyCompany', [() => sse(['Something else.'], { retrieval_degraded: false, sources: [] })]), /nothing is indexed yet/)
  await assert.rejects(only('emptyCompany', [() => liveRecord('Nothing is not indexed yet')]), /stop without generation/)
  await assert.rejects(only('summaryHandoff', [() => liveRecord('Summary')]), /expected handoff/)
  await assert.rejects(only('importContinuation', [() => liveRecord('reviewed', { import_task_statuses: [] })]), /saved import status/)
  await assert.rejects(only('importContinuation', [() => liveRecord('reviewed', { import_task_statuses: [{}], sources: [] })]), /reviewed record/)
  await assert.rejects(only('revoked', [() => sse(['Revoked marker'], { sources: [] })]),
    error => /revoked record chat exposed/.test(error.message) && !error.message.includes('Revoked marker'))
})

test('reports an expected gap without failing and flags it when the feature has shipped', async () => {
  const gap = { ...scenarios.emptyCompany, expectedGap: true }
  const result = await verifyGroundedChat(scenarioEnv({}, { emptyCompany: gap }),
    scenarioFetch([() => liveRecord('Generated anyway')]).fetcher)
  assert.equal(result.emptyCompany, 'known-gap')
  assert.match(result.knownGaps.emptyCompany, /stop without generation/)
  const closed = await verifyGroundedChat(scenarioEnv({}, { emptyCompany: gap }), scenarioFetch([noIndex]).fetcher)
  assert.equal(closed.emptyCompany, 'gap-closed')
  assert.equal(closed.knownGaps, undefined)
})

test('fails when the scenario withhold rate exceeds the configured maximum', async () => {
  const withheld = () => liveRecord('Withheld', { verification: { outcome: 'requires_review' } })
  const run = (max, handlers) => verifyGroundedChat(scenarioEnv({ maxWithholdRate: max },
    { namedRecord: scenarios.namedRecord, summaryHandoff: scenarios.summaryHandoff }), scenarioFetch(handlers).fetcher)
  const handoff = () => liveRecord('Summary', { ui_actions: [{ capability_key: 'sales.summary.handoff' }] })
  assert.equal((await run(0.5, [withheld, handoff])).withholdRate, '1/2')
  await assert.rejects(run(0.25, [withheld, handoff]), /withhold rate 1\/2 exceeds/)
  await assert.rejects(verifyGroundedChat(scenarioEnv({}, { namedRecord: scenarios.namedRecord }),
    scenarioFetch([withheld]).fetcher), /verified answer/)
})

test('validates scenario fixtures before any network calls', async () => {
  for (const [change, expected] of [
    [{ namedRecord: { ...scenarios.namedRecord, entityId: '0' } }, /invalid namedRecord chat fixture/],
    [{ namedRecord: { ...scenarios.namedRecord, expectedGap: 'yes' } }, /invalid namedRecord chat fixture/],
    [{ followUp: { ...scenarios.followUp, chatSessionKey: 'bad key' } }, /invalid followUp chat fixture/],
    [{ followUp: { ...scenarios.followUp, first: { ...scenarios.followUp.first, question: scenarios.followUp.question } } }, /invalid followUp chat fixture/],
    [{ nonEnglish: { de: scenarios.nonEnglish.fr } }, /invalid nonEnglish chat fixture/],
    [{ nonEnglish: { fr: { ...scenarios.nonEnglish.fr, expectedText: '' } } }, /invalid nonEnglish chat fixture/],
    [{ emptyCompany: { ...scenarios.emptyCompany, companyId: 1 } }, /invalid emptyCompany chat fixture/],
    [{ summaryHandoff: { ...scenarios.summaryHandoff, capabilityKey: 'Bad Key' } }, /invalid summaryHandoff chat fixture/],
    [{ revoked: { ...scenarios.revoked, uiContext: undefined } }, /invalid revoked chat fixture/],
    [{ importContinuation: { ...scenarios.importContinuation, importTaskRefs: ['short'] } }, /invalid importContinuation chat fixture/],
    [{ importContinuation: { ...scenarios.importContinuation, expectedRecords: [] } }, /invalid importContinuation chat fixture/],
    [{ maxWithholdRate: 2 }, /maxWithholdRate/],
  ]) {
    await assert.rejects(verifyGroundedChat(scenarioEnv(change), async () => assert.fail('unexpected network call')), expected)
  }
})

test('reports an expired session precisely and pre-flights each distinct cookie once without a model call', async () => {
  await assert.rejects(verifyGroundedChat(env, async () => new Response('', { status: 401 })),
    /fresh chat session is expired or invalid; sign in the acceptance user again/)
  const calls = []
  await preflightSessions(scenarioEnv({}, { namedRecord: scenarios.namedRecord, summaryHandoff: scenarios.summaryHandoff }), async (url, options) => {
    calls.push([options.headers.Cookie, JSON.parse(options.body).query])
    return new Response('{"error":"query is required"}', { status: 400 })
  })
  assert.deepEqual(calls, [['fixture-session=1', ''], ['fixture-session=2', ''], ['scenario-session=4', '']])
  await assert.rejects(preflightSessions(env, async () => new Response('', { status: 401 })), /fresh session cookie is expired or invalid/)
  await assert.rejects(preflightSessions(env, async () => new Response('', { status: 502 })), /pre-flight returned HTTP 502/)
})

const candidateSha = 'a'.repeat(40)
const baselineSha = 'b'.repeat(40)
const registryEnv = {
  ...env,
  AI_CHAT_ACCEPTANCE_SOURCE: 'registry',
  RELEASE_SHA: candidateSha,
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token?job=acceptance',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
}
const withoutCookie = ({ cookie, ...metadata }) => metadata
const registryFixtures = {
  fresh: { ...withoutCookie(config.fresh), provisionedReleaseSha: candidateSha },
  upgraded: { ...withoutCookie(config.upgraded), provisionedReleaseSha: baselineSha },
}
const workosToken = (signature, expiry) =>
  `header.${Buffer.from(JSON.stringify({ exp: Math.floor(expiry / 1000) })).toString('base64url')}.${signature}`
const sessionsExp = Date.now() + 15 * 60_000
const registryReply = {
  releaseSha: candidateSha,
  fixtures: registryFixtures,
  accessTokens: { '1': workosToken('fresh', sessionsExp), '2': workosToken('upgraded', sessionsExp) },
}

function registryFetch(stage, ...responses) {
  const exchanges = []
  const chats = []
  let activeTokens = {}
  const fetcher = async (address, options) => {
    const url = new URL(address)
    assert.equal(options.redirect, 'error')
    if (url.hostname === 'pipelines.actions.githubusercontent.com') {
      assert.equal(url.searchParams.get('job'), 'acceptance')
      assert.equal(url.searchParams.get('audience'), 'lumiere-grounded-chat-acceptance')
      assert.deepEqual(options.headers, { Authorization: 'Bearer github-request-token' })
      return Response.json({ value: 'github-issued-oidc-token' })
    }
    assert.equal(url.origin, env.AI_CHAT_ACCEPTANCE_URL)
    const body = JSON.parse(options.body)
    assert.equal(options.headers.Origin, url.origin)
    assert.equal(options.headers.Cookie, undefined)
    if (url.pathname === '/api/ai/acceptance/session') {
      assert.equal(options.method, 'POST')
      assert.equal(options.headers.Authorization, 'Bearer github-issued-oidc-token')
      assert.deepEqual(body, { stage, ...(stage !== 'nightly' && { releaseSha: candidateSha }) })
      exchanges.push(body)
      const response = responses.shift() ?? Response.json(registryReply)
      if (response.ok) activeTokens = (await response.clone().json()).accessTokens
      return response
    }
    assert.equal(url.pathname, '/api/ai/rag/stream')
    assert.equal(options.headers.Authorization, `Bearer ${activeTokens[body.companyId]}`)
    chats.push(body)
    if (!body.query) return new Response('', { status: 400 })
    return stream(body.companyId === 1 ? config.fresh : config.upgraded)
  }
  return { fetcher, exchanges, chats }
}

test('registry preflight accepts the existing upgraded fixture without requiring the fresh candidate', async () => {
  const { fetcher, chats } = registryFetch('preflight', Response.json({
    releaseSha: baselineSha,
    fixtures: { upgraded: registryFixtures.upgraded },
    accessTokens: { '2': registryReply.accessTokens[2] },
  }))
  assert.equal(await runAcceptanceCheck(registryEnv, 'preflight', { fetcher }), undefined)
  assert.deepEqual(chats, [{ companyId: 2, query: '' }])
})

test('registry release and nightly checks stream the two company scopes with separate bearer sessions', async () => {
  for (const stage of ['verify', 'nightly']) {
    const { fetcher, exchanges, chats } = registryFetch(stage)
    assert.deepEqual(await runAcceptanceCheck(registryEnv, stage, { fetcher }),
      { fresh: 'passed', upgraded: 'passed' })
    assert.equal(exchanges.length, 1)
    assert.deepEqual(chats.map(({ companyId, query }) => [companyId, query]), [
      [1, ''], [2, ''], [1, config.fresh.question], [2, config.upgraded.question],
    ])
  }
})

test('registry rejects wrong releases, stale freshness, and mismatched company sessions without using legacy', async () => {
  for (const [reply, error] of [
    [{ ...registryReply, releaseSha: baselineSha }, /does not serve the requested release/],
    [{ ...registryReply, fixtures: { ...registryFixtures, fresh: { ...registryFixtures.fresh, provisionedReleaseSha: baselineSha } } },
      /was not provisioned on the deployed release/],
    [{ ...registryReply, accessTokens: { '2': registryReply.accessTokens[2] } }, /omitted a valid company session/],
    [{ ...registryReply, accessTokens: { ...registryReply.accessTokens, '3': 'unexpected-session' } },
      /unexpected or shared company sessions/],
    [{ ...registryReply, accessTokens: { '1': registryReply.accessTokens[1], '2': registryReply.accessTokens[1] } },
      /unexpected or shared company sessions/],
    [{ ...registryReply, accessTokens: { ...registryReply.accessTokens, '1': workosToken('long-lived', sessionsExp + 40 * 60_000) } },
      /omitted a valid company session/],
    [{ ...registryReply, fixtures: { ...registryFixtures, revoked: { ...scenarios.revoked, companyId: 1, cookie: undefined } } },
      /revoked fixture must use a dedicated company session/],
    [{ ...registryReply, fixtures: { ...registryFixtures, upgraded: { ...registryFixtures.upgraded, cookie: 'should-not-pass' } } },
      /invalid fixture authentication/],
  ]) {
    const { fetcher, chats } = registryFetch('verify', Response.json(reply))
    await assert.rejects(runAcceptanceCheck(registryEnv, 'verify', { fetcher }), error)
    assert.deepEqual(chats, [])
  }
  const { fetcher, chats } = registryFetch('verify', Response.json({ detail: 'secret-server-message' }, { status: 401 }))
  await assert.rejects(runAcceptanceCheck(registryEnv, 'verify', { fetcher }),
    error => /registry session exchange returned HTTP 401/.test(error.message) && !error.message.includes('secret-server-message'))
  assert.deepEqual(chats, [])
})

test('only a candidate fresh fixture that is explicitly pending is retried', async () => {
  const proof = 'activation.payload.signature'
  const pending = (releaseSha = candidateSha, activationProof = proof) =>
    Response.json({ code: 'fresh_fixture_pending', releaseSha, activationProof }, { status: 409 })
  const { fetcher, chats, exchanges } = registryFetch('verify', pending(), pending(candidateSha, 'new.payload.signature'))
  const reported = []
  await runAcceptanceCheck(registryEnv, 'verify', {
    fetcher,
    onPending: (...args) => reported.push(args),
    wait: async ms => {
      assert.equal(ms, 30_000)
      assert.equal(chats.length, 0)
    },
  })
  assert.equal(exchanges.length, 3)
  assert.deepEqual(reported, [[candidateSha, proof]])
  const nightly = registryFetch('nightly', pending())
  const unknown = registryFetch('verify', Response.json({ code: 'other_problem' }, { status: 409 }))
  const wrongRelease = registryFetch('verify', pending(baselineSha))
  const invalidProof = registryFetch('verify', pending(candidateSha, 'untrusted\npayload'))
  for (const [stage, fixtureFetch] of [['nightly', nightly], ['verify', unknown], ['verify', wrongRelease], ['verify', invalidProof]]) {
    await assert.rejects(runAcceptanceCheck(registryEnv, stage, {
      fetcher: fixtureFetch.fetcher, wait: async () => assert.fail('unexpected retry'),
    }), /HTTP 409/)
    assert.equal(fixtureFetch.chats.length, 0)
  }
  const neverReady = registryFetch('verify', ...Array.from({ length: 31 }, () => pending()))
  await assert.rejects(runAcceptanceCheck(registryEnv, 'verify', {
    fetcher: neverReady.fetcher, wait: async () => {},
  }), /fresh chat fixture is missing for this deployed release/)
  assert.equal(neverReady.exchanges.length, 31)
  assert.equal(neverReady.chats.length, 0)
})

test('renewal happens before the next chat call and cannot change the deployed release or fixtures', async () => {
  const changed = { ...registryReply, fixtures: {
    ...registryFixtures, upgraded: { ...registryFixtures.upgraded, expectedAnswerText: 'unreviewed fact' },
  } }
  const renewed = { ...registryReply, accessTokens: {
    '1': workosToken('fresh-renewed', sessionsExp + 10 * 60_000),
    '2': workosToken('upgraded-renewed', sessionsExp + 10 * 60_000),
  } }
  for (const [reply, expected] of [[renewed, 'success'], [changed, 'failure']]) {
    const { fetcher, exchanges, chats } = registryFetch('verify', Response.json(registryReply), Response.json(reply))
    const run = runAcceptanceCheck(registryEnv, 'verify', {
      fetcher,
      now: () => chats.some(chat => chat.query) ? sessionsExp - 60_000 : Date.now(),
    })
    if (expected === 'success') assert.deepEqual(await run, { fresh: 'passed', upgraded: 'passed' })
    else await assert.rejects(run, /changed the release or fixtures while renewing/)
    assert.equal(exchanges.length, 2)
    assert.deepEqual(chats.filter(chat => chat.query).map(chat => chat.companyId), expected === 'success' ? [1, 2] : [1])
  }
})

test('registry never sends the GitHub token request credential to a different host or a redirect', async () => {
  await assert.rejects(runAcceptanceCheck({
    ...registryEnv, ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com.bad.example/token',
  }, 'verify', {
    fetcher: async () => assert.fail('unexpected network call'),
  }), /GitHub Actions OIDC request configuration is invalid/)
  await assert.rejects(runAcceptanceCheck(registryEnv, 'verify', {
    fetcher: async (_address, options) => {
      assert.equal(options.redirect, 'error')
      throw new Error('redirect detail must not leak')
    },
  }), /GitHub Actions OIDC exchange transport failed/)
})
