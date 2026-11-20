#!/usr/bin/env node
// Authenticated release acceptance for indexed documents, an optional live journal and optional scenarios.
import { appendFileSync } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const positive = value => Number.isSafeInteger(value) && value > 0
const text = value => typeof value === 'string' && value.trim().length > 0
const cohorts = ['fresh', 'upgraded']
const journalContext = { route: '/accounting', module: 'accounting', active_tab: 'journal-entries' }
const acceptanceBearer = Symbol('acceptanceBearer')

const validSession = fixture => positive(fixture?.companyId)
  && (typeof fixture[acceptanceBearer] === 'function' || (text(fixture.cookie) && /^[\x20-\x7e]+$/.test(fixture.cookie)))
const token = value => typeof value === 'string' && value.length <= 16384 && /^[A-Za-z0-9._~+/-]+=*$/.test(value)
const gitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const compactProof = value => typeof value === 'string' && value.length <= 4096
  && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
const recordId = value => {
  const id = positive(value) ? String(value) : value
  return typeof id === 'string' && /^[1-9][0-9]{0,19}$/.test(id)
    && BigInt(id) <= 18446744073709551615n ? id : null
}

function validateJournalFixture(journal) {
  requireValue(validSession(journal) && recordId(journal.accountMoveId)
    && text(journal.question) && text(journal.expectedAmountText)
    && /\d/.test(journal.expectedAmountText) && text(journal.expectedDebitText), 'invalid journal chat fixture')
  if (journal.foreign !== undefined) {
    const foreign = journal.foreign
    requireValue(recordId(foreign?.accountMoveId) && recordId(foreign.accountMoveId) !== recordId(journal.accountMoveId)
      && text(foreign.question) && text(foreign.forbiddenText), 'invalid foreign journal chat fixture')
  }
  if (journal.ambiguous !== undefined) {
    const ambiguous = journal.ambiguous
    requireValue(text(ambiguous?.question) && ambiguous.question.trim() !== journal.question.trim()
      && text(ambiguous.expectedClarificationText), 'invalid ambiguous journal chat fixture')
  }
}

const entityType = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value)
const recordRef = ref => entityType(ref?.entityType) && recordId(ref.entityId) !== null
const gapFlag = fixture => fixture.expectedGap === undefined || typeof fixture.expectedGap === 'boolean'
const baseScenario = fixture => validSession(fixture) && text(fixture.question) && gapFlag(fixture)
const sessionKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const capabilityKey = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,159}$/.test(value)
const uiContextOk = value => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value)
  && ['route', 'module', 'active_tab'].every(key => value[key] === undefined || text(value[key])))
const languages = ['fr', 'rw']

// Optional, fixture-driven release scenarios. Each is strictly validated when present.
const scenarioValidators = {
  namedRecord: fixture => baseScenario(fixture) && recordRef(fixture) && text(fixture.expectedText) && uiContextOk(fixture.uiContext),
  followUp: fixture => baseScenario(fixture) && sessionKey(fixture.chatSessionKey)
    && text(fixture.first?.question) && recordRef(fixture.first)
    && fixture.first.question.trim() !== fixture.question.trim()
    && (fixture.expectedText === undefined || text(fixture.expectedText)),
  nonEnglish: (fixture, name, config) => fixture !== null && typeof fixture === 'object' && !Array.isArray(fixture)
    && Object.keys(fixture).length > 0 && Object.keys(fixture).every(language => languages.includes(language)
      && scenarioValidators.namedRecord(fixture[language])),
  emptyCompany: (fixture, name, config) => baseScenario(fixture) && text(fixture.expectedText)
    && fixture.companyId !== config.fresh.companyId && fixture.companyId !== config.upgraded.companyId,
  summaryHandoff: fixture => baseScenario(fixture) && capabilityKey(fixture.capabilityKey) && uiContextOk(fixture.uiContext),
  revoked: fixture => baseScenario(fixture) && recordRef(fixture) && text(fixture.forbiddenText)
    && text(fixture.uiContext?.route) && text(fixture.uiContext.module) && uiContextOk(fixture.uiContext),
  importContinuation: fixture => baseScenario(fixture) && Array.isArray(fixture.importTaskRefs)
    && fixture.importTaskRefs.length >= 1 && fixture.importTaskRefs.length <= 4
    && fixture.importTaskRefs.every(taskId => typeof taskId === 'string' && /^[0-9a-f]{32}$/.test(taskId))
    && new Set(fixture.importTaskRefs).size === fixture.importTaskRefs.length
    && Array.isArray(fixture.expectedRecords) && fixture.expectedRecords.length >= 1 && fixture.expectedRecords.every(recordRef)
    && (fixture.expectedText === undefined || text(fixture.expectedText)),
}

function acceptanceOrigin(env) {
  let origin
  try {
    origin = new URL(env.AI_CHAT_ACCEPTANCE_URL)
  } catch {
    throw new Error('configure AI_CHAT_ACCEPTANCE_URL')
  }
  requireValue(origin.protocol === 'https:' && !origin.username && !origin.password
    && !origin.search && !origin.hash && origin.pathname === '/', 'chat acceptance URL must be an HTTPS origin')
  return origin.origin
}

function validateFixtures(config, preflightOnly = false) {
  for (const cohort of preflightOnly ? ['upgraded'] : cohorts) {
    const fixture = config?.[cohort]
    requireValue(validSession(fixture) && positive(fixture.documentId)
      && text(fixture?.sourceVersion) && text(fixture?.question) && text(fixture?.expectedAnswerText),
    `invalid ${cohort} chat fixture`)
  }
  if (preflightOnly) return
  requireValue(config.fresh.companyId !== config.upgraded.companyId, 'chat fixtures must use different companies')
  if (config.journal !== undefined) validateJournalFixture(config.journal)
  if (config.maxWithholdRate !== undefined) {
    requireValue(typeof config.maxWithholdRate === 'number' && config.maxWithholdRate >= 0 && config.maxWithholdRate <= 1,
      'maxWithholdRate must be a number from 0 to 1')
  }
  for (const [name, validate] of Object.entries(scenarioValidators)) {
    if (config[name] !== undefined) requireValue(validate(config[name], name, config), `invalid ${name} chat fixture`)
  }
}

export function readChatFixtures(env) {
  const origin = acceptanceOrigin(env)
  let config
  try { config = JSON.parse(env.AI_CHAT_ACCEPTANCE_JSON) } catch {
    throw new Error('configure the AI_CHAT_ACCEPTANCE_JSON fixture secret in legacy mode')
  }
  validateFixtures(config)
  return { origin, config }
}

const acceptanceAudience = 'lumiere-grounded-chat-acceptance'
const maxRegistryReplyBytes = 256 * 1024
const registryLabel = 'chat acceptance registry session exchange'
const chatTimeoutMs = 180_000
const minRemainingSessionMs = chatTimeoutMs + 30_000
const maxSessionLifetimeMs = 31 * 60_000 // 30-minute TTL plus bounded clock skew.

async function readBoundedJson(response, label) {
  requireValue(response.headers.get('content-type')?.split(';')[0].trim() === 'application/json',
    `${label} returned a non-JSON response`)
  requireValue(response.body, `${label} returned an empty response`)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let length = 0, raw = ''
  try {
    for await (const chunk of response.body) {
      length += chunk.byteLength
      if (length > maxRegistryReplyBytes) throw new Error()
      raw += decoder.decode(chunk, { stream: true })
    }
    return JSON.parse(raw + decoder.decode())
  } catch {
    throw new Error(`${label} returned invalid or overlarge JSON`)
  }
}

async function registryFetch(fetcher, url, options, label) {
  try {
    return await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...options })
  } catch {
    throw new Error(`${label} transport failed`)
  }
}

function githubOidcRequest(env) {
  let url
  try { url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL) } catch {
    throw new Error('configure GitHub Actions OIDC (id-token: write)')
  }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
    && url.hostname.endsWith('.actions.githubusercontent.com') && token(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  'GitHub Actions OIDC request configuration is invalid')
  url.searchParams.set('audience', acceptanceAudience)
  return { url: url.href, credential: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }
}

async function githubOidcToken(request, fetcher) {
  const label = 'GitHub Actions OIDC exchange'
  const response = await registryFetch(fetcher, request.url, { headers: { Authorization: `Bearer ${request.credential}` } }, label)
  requireValue(response.ok, `${label} returned HTTP ${response.status}`)
  const body = await readBoundedJson(response, label)
  requireValue(token(body?.value), `${label} did not issue a token`)
  return body.value
}

// The API validates JWT signatures and authorization. This claim only schedules renewal.
function sessionExpiry(tokenValue) {
  if (!token(tokenValue)) return NaN
  const parts = tokenValue.split('.')
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return NaN
  try {
    const { exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return Number.isSafeInteger(exp) ? exp * 1000 : NaN
  } catch {
    return NaN
  }
}

function authenticateRegistryFixtures(fixtures, accessTokens, preflightOnly, credentialFor, now) {
  requireValue(object(fixtures) && object(accessTokens), 'chat acceptance registry returned invalid fixtures or sessions')
  const companyIds = new Set()
  const bind = fixture => {
    requireValue(object(fixture) && positive(fixture.companyId)
      && !Object.hasOwn(fixture, 'cookie') && !Object.hasOwn(fixture, 'accessToken'),
      'chat acceptance registry returned invalid fixture authentication')
    const companyKey = String(fixture.companyId)
    const remaining = sessionExpiry(accessTokens[companyKey]) - now()
    requireValue(Object.hasOwn(accessTokens, companyKey) && remaining > 0 && remaining <= maxSessionLifetimeMs,
      'chat acceptance registry omitted a valid company session')
    companyIds.add(companyKey)
    return { ...fixture, [acceptanceBearer]: credentialFor }
  }
  const config = { upgraded: bind(fixtures.upgraded) }
  if (!preflightOnly) {
    config.fresh = bind(fixtures.fresh)
    if (fixtures.journal !== undefined) config.journal = bind(fixtures.journal)
    if (fixtures.maxWithholdRate !== undefined) config.maxWithholdRate = fixtures.maxWithholdRate
    for (const name of Object.keys(scenarioValidators)) {
      if (name === 'revoked' || fixtures[name] === undefined) continue
      if (name === 'nonEnglish') {
        requireValue(object(fixtures.nonEnglish), 'chat acceptance registry returned invalid language fixtures')
        config.nonEnglish = Object.fromEntries(Object.entries(fixtures.nonEnglish).map(([language, fixture]) => [language, bind(fixture)]))
      } else {
        config[name] = bind(fixtures[name])
      }
    }
    if (fixtures.revoked !== undefined) {
      requireValue(!companyIds.has(String(fixtures.revoked?.companyId)),
        'the revoked fixture must use a dedicated company session')
      config.revoked = bind(fixtures.revoked)
    }
  }
  requireValue(Object.keys(accessTokens).length === companyIds.size
    && new Set(Object.values(accessTokens)).size === companyIds.size,
  'chat acceptance registry returned unexpected or shared company sessions')
  validateFixtures(config, preflightOnly)
  return config
}

async function readRegistrySession(response, stage, releaseSha) {
  requireValue(response.ok, `${registryLabel} returned HTTP ${response.status}`)
  const body = await readBoundedJson(response, registryLabel)
  requireValue(gitSha(body?.releaseSha), `${registryLabel} returned an invalid release`)
  if (stage !== 'preflight') {
    requireValue(stage === 'nightly' || body.releaseSha === releaseSha, 'chat acceptance registry does not serve the requested release')
    requireValue(body.fixtures?.fresh?.provisionedReleaseSha === body.releaseSha,
      'fresh chat fixture was not provisioned on the deployed release')
  }
  return body
}

async function readRegistryFixtures(env, stage, { fetcher, wait, onPending, now }) {
  const origin = acceptanceOrigin(env)
  const releaseSha = stage === 'nightly' ? undefined : env.RELEASE_SHA?.toLowerCase()
  requireValue(stage === 'nightly' || gitSha(releaseSha), 'set RELEASE_SHA to the full release commit SHA')
  const request = githubOidcRequest(env)
  const exchange = async () => {
    const idToken = await githubOidcToken(request, fetcher)
    return registryFetch(fetcher, `${origin}/api/ai/acceptance/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, ...(releaseSha && { releaseSha }) }),
    }, registryLabel)
  }
  let response = await exchange()
  for (let attempt = 0; stage === 'verify' && response.status === 409; attempt++) {
    const body = await readBoundedJson(response, registryLabel)
    requireValue(body?.code === 'fresh_fixture_pending' && body.releaseSha === releaseSha && compactProof(body.activationProof),
      `${registryLabel} returned HTTP 409`)
    requireValue(attempt < 30, 'the fresh chat fixture is missing for this deployed release; provision and register it before retrying')
    if (attempt === 0) onPending(releaseSha, body.activationProof)
    await wait(30_000)
    response = await exchange()
  }
  const original = await readRegistrySession(response, stage, releaseSha)
  let accessTokens = original.accessTokens
  const preflightOnly = stage === 'preflight'
  const credentialFor = async companyId => {
    if (sessionExpiry(accessTokens[companyId]) - now() <= minRemainingSessionMs) {
      const refreshed = await readRegistrySession(await exchange(), stage, releaseSha)
      requireValue(refreshed.releaseSha === original.releaseSha && isDeepStrictEqual(refreshed.fixtures, original.fixtures),
        'chat acceptance registry changed the release or fixtures while renewing the session')
      authenticateRegistryFixtures(refreshed.fixtures, refreshed.accessTokens, preflightOnly, credentialFor, now)
      accessTokens = refreshed.accessTokens
    }
    requireValue(sessionExpiry(accessTokens[companyId]) - now() > minRemainingSessionMs,
      'chat acceptance registry issued a session too short for the chat timeout')
    return accessTokens[companyId]
  }
  return { origin, config: authenticateRegistryFixtures(original.fixtures, accessTokens, preflightOnly, credentialFor, now) }
}

function verifyProviderReply(body) {
  requireValue(body.retrieval_degraded === false && text(body.provider) && text(body.model)
    && positive(body.run_id), 'chat did not return a completed provider response with healthy retrieval')
}

export function verifyGroundedReply(body, fixture) {
  verifyProviderReply(body)
  requireValue(['admitted', 'qualified'].includes(body.verification?.outcome)
    && body.provenance?.persisted === true && positive(body.provenance.contributionId)
    && body.provenance.claimIds?.some(positive), 'chat did not release a verified answer with saved provenance')
  requireValue(text(body.answer) && body.answer.toLowerCase().includes(fixture.expectedAnswerText.toLowerCase()),
    'chat reply missed the known fact')
  const sourceKey = `document:${fixture.documentId}`
  const sources = body.sources?.filter(source => source?.kind === 'passage' && source.source_key === sourceKey
    && source.source_version === fixture.sourceVersion && positive(source.passage_id)) ?? []
  requireValue(sources.length > 0 && body.provenance.claims?.some(claim => claim?.passageSupport?.some(support =>
    support?.id === sourceKey && support.source_version === fixture.sourceVersion
      && sources.some(source => source.passage_key === support.passage_key))),
  'chat reply did not cite the expected source version in its saved claims')
}

const normalizeText = value => value.normalize('NFKC').toLowerCase()
  .replace(/\*\*|__|`/g, '').replace(/\s+/gu, ' ').trim()

function hasFact(value, fact) {
  if (!text(value)) return false
  const literal = normalizeText(fact).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}]|\\d[.,])${literal}(?![\\p{L}\\p{N}]|[.,]\\d)`, 'u')
    .test(normalizeText(value))
}

function verifyJournalReply(body, fixture) {
  const generated = body.provider != null || body.model != null || body.run_id != null
  if (generated) verifyProviderReply(body)
  else requireValue(body.retrieval_degraded === false && Array.isArray(body.verification?.methods)
    && body.verification.methods.includes('deterministic'), 'journal answer lacks deterministic read verification')
  requireValue(['admitted', 'qualified'].includes(body.verification?.outcome),
    'journal question did not release a verified answer')
  const id = recordId(fixture.accountMoveId)
  requireValue(Array.isArray(body.sources) && body.sources.some(source => source?.kind === 'live'
    && source.trust === 'authoritative' && source.entity_type === 'account_move' && source.entity_id === id
    && Number.isFinite(Date.parse(source.snapshot_at))), 'journal answer did not cite the exact live entry')
  const facts = [
    [fixture.expectedAmountText, 'amount', /^total\s*:/],
    [fixture.expectedDebitText, 'debit account', /^debit account\s*:/],
  ]
  for (const [fact, name, label] of facts) {
    requireValue(hasFact(body.answer, fact), `journal answer missed the expected ${name}`)
    requireValue(Array.isArray(body.provenance?.claims) && body.provenance.claims.some(claim =>
      hasFact(claim?.text, fact) && claim.verificationOutcome === 'supported'
      && (generated || claim.verificationMethod === 'deterministic' && label.test(normalizeText(claim.text)))
      && claim.supportRefs?.some(ref => ref?.kind === 'live_snapshot' && ref.id === `account_move:${id}`)),
    `journal claim for the ${name} did not cite the live entry as verified support`)
  }
}

function verifyUngroundedReply(body) {
  requireValue(Array.isArray(body.sources) && body.sources.length === 0
    && body.run_id == null && body.provider == null && body.model == null
    && body.verification == null && body.provenance == null,
  'journal lookup should stop without generation or evidence')
}

function completedStream(raw) {
  let metadata, done = false
  const answer = []
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const event = /^event: *(.*)$/m.exec(block)?.[1]
    if (!event) continue
    requireValue(!done, 'chat sent events after completion')
    const data = [...block.matchAll(/^data: ?(.*)$/gm)].map(match => match[1]).join('\n')
    if (event === 'delta') answer.push(data)
    if (event === 'sources') {
      requireValue(!metadata, 'chat sent duplicate source metadata')
      try { metadata = JSON.parse(data) } catch { throw new Error('chat returned invalid source metadata') }
    }
    if (event === 'error') throw new Error('chat returned a stream error')
    if (event === 'done') done = true
  }
  requireValue(done && metadata && typeof metadata === 'object', 'chat stream did not complete with source metadata')
  return { ...metadata, answer: answer.join('') }
}

async function requestChat(origin, fetcher, label, session, query, uiContext, extra) {
  const authentication = session[acceptanceBearer]
    ? { Authorization: `Bearer ${await session[acceptanceBearer](session.companyId)}` }
    : { Cookie: session.cookie }
  try {
    return await fetcher(`${origin}/api/ai/rag/stream`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(chatTimeoutMs),
      headers: { Origin: origin, ...authentication, 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: session.companyId, query, ...(uiContext && { ui_context: uiContext }), ...extra }),
    })
  } catch {
    throw new Error(`${label} chat transport failed; inspect the run before retrying`)
  }
}

async function checkStream(response, label, check) {
  requireValue(response.status !== 401, `${label} chat session is expired or invalid; sign in the acceptance user again or renew the registry session`)
  requireValue(response.ok, `${label} chat returned HTTP ${response.status}`)
  requireValue(response.headers.get('content-type')?.startsWith('text/event-stream'), `${label} chat did not return an event stream`)
  const raw = await response.text().catch(() => null)
  requireValue(raw, `${label} chat stream could not be read`)
  try {
    check(completedStream(raw), raw)
  } catch (error) {
    throw new Error(`${label} chat: ${error instanceof TypeError ? 'invalid response schema' : error.message}`)
  }
}

async function checkForeignJournal(response, foreign, label = 'foreign journal') {
  const noForeignFacts = raw => requireValue(!normalizeText(raw).includes(normalizeText(foreign.forbiddenText)),
    `${label} chat exposed the protected test fact`)
  if (response.status === 403 || response.status === 404) {
    const raw = await response.text().catch(() => null)
    requireValue(raw !== null, `${label} chat denial could not be read`)
    noForeignFacts(raw)
    return
  }
  await checkStream(response, label, (body, raw) => {
    noForeignFacts(raw)
    requireValue(!text(body.answer) || !normalizeText(body.answer).includes(normalizeText(foreign.forbiddenText)),
      `${label} chat exposed the protected test fact`)
    verifyUngroundedReply(body)
  })
}


const isWithheld = body => ['requires_review', 'blocked'].includes(body.verification?.outcome)

// Run status, verification outcome and sources; never only the reply text.
function verifyRunReply(body, { requireVerification = true } = {}) {
  requireValue(body.retrieval_degraded === false && Array.isArray(body.sources), 'chat did not return healthy retrieval and sources')
  const generated = body.provider != null || body.model != null || body.run_id != null
  if (generated) verifyProviderReply(body)
  if (requireVerification || body.verification != null) {
    requireValue(['admitted', 'qualified'].includes(body.verification?.outcome), 'chat did not release a verified answer')
  }
  return generated
}

const hasLiveRecord = (body, record) => body.sources.some(source => source?.kind === 'live'
  && source.entity_type === record.entityType && source.entity_id === recordId(record.entityId)
  && Number.isFinite(Date.parse(source.snapshot_at)))

function verifyRecordReply(body, record, expectedText) {
  const generated = verifyRunReply(body)
  if (!generated) requireValue(body.verification.methods?.includes('deterministic'), 'record answer lacks deterministic read verification')
  requireValue(hasLiveRecord(body, record), 'chat reply did not cite the expected record')
  if (expectedText !== undefined) requireValue(hasFact(body.answer, expectedText), 'chat reply missed the expected fact')
}

const scenarioRunners = {
  async namedRecord(ctx, fixture) {
    await ctx.turn('named record', fixture, fixture.question, fixture.uiContext, undefined,
      body => verifyRecordReply(body, fixture, fixture.expectedText))
  },
  async followUp(ctx, fixture) {
    const extra = { chat_session_key: `${fixture.chatSessionKey}-${ctx.nonce}` }
    if (await ctx.turn('follow-up first turn', fixture, fixture.first.question, undefined, extra,
      body => verifyRecordReply(body, fixture.first))) return
    await ctx.turn('follow-up', fixture, fixture.question, undefined, extra, body => {
      requireValue(body.earlier_context_unavailable !== true, 'follow-up lost the earlier conversation')
      verifyRecordReply(body, fixture.first, fixture.expectedText)
    })
  },
  async nonEnglish(ctx, fixture, language) {
    await ctx.turn(`${language} question`, fixture, fixture.question, fixture.uiContext, undefined,
      body => verifyRecordReply(body, fixture, fixture.expectedText))
  },
  async emptyCompany(ctx, fixture) {
    await ctx.turn('empty company', fixture, fixture.question, undefined, undefined, body => {
      requireValue(body.retrieval_degraded === false, 'empty company retrieval was degraded')
      verifyUngroundedReply(body)
      requireValue(hasFact(body.answer, fixture.expectedText), 'empty company reply did not say nothing is indexed yet')
    }, { withholdable: false })
  },
  async summaryHandoff(ctx, fixture) {
    await ctx.turn('summary handoff', fixture, fixture.question, fixture.uiContext, undefined, body => {
      verifyRunReply(body, { requireVerification: false })
      requireValue(Array.isArray(body.ui_actions) && body.ui_actions.some(action => action?.capability_key === fixture.capabilityKey),
        'summary reply did not offer the expected handoff')
    })
  },
  async revoked(ctx, fixture) {
    const response = await requestChat(ctx.origin, ctx.fetcher, 'revoked record', fixture, fixture.question, {
      ...fixture.uiContext, entity_type: fixture.entityType, entity_id: recordId(fixture.entityId), explicit_record: true,
    })
    await checkForeignJournal(response, { forbiddenText: fixture.forbiddenText }, 'revoked record')
  },
  async importContinuation(ctx, fixture) {
    const refs = fixture.importTaskRefs.map(taskId => ({ taskId, companyId: String(fixture.companyId) }))
    await ctx.turn('import continuation', fixture, fixture.question, undefined, { import_task_refs: refs }, body => {
      verifyRunReply(body, { requireVerification: false })
      requireValue(Array.isArray(body.import_task_statuses) && body.import_task_statuses.length >= refs.length,
        'import continuation did not return its saved import status')
      for (const record of fixture.expectedRecords) {
        requireValue(hasLiveRecord(body, record), 'import continuation did not cite a reviewed record')
      }
      if (fixture.expectedText !== undefined) requireValue(hasFact(body.answer, fixture.expectedText), 'import continuation missed the expected fact')
    })
  },
}

async function runScenarios(origin, fetcher, config, result) {
  const tally = { total: 0, withheld: 0 }
  const countWithheld = config.maxWithholdRate !== undefined
  const nonce = Date.now().toString(36)
  const knownGaps = {}
  for (const [name, runScenario] of Object.entries(scenarioRunners)) {
    const fixture = config[name]
    if (fixture === undefined) continue
    const entries = name === 'nonEnglish' ? Object.entries(fixture) : [[undefined, fixture]]
    for (const [language, item] of entries) {
      const key = language ? `${name}${language[0].toUpperCase()}${language.slice(1)}` : name
      let withheld = false
      const ctx = { origin, fetcher, nonce, async turn(label, session, query, uiContext, extra, check, { withholdable = true } = {}) {
        const response = await requestChat(origin, fetcher, label, session, query, uiContext, extra)
        let skipped = false
        await checkStream(response, label, (body, raw) => {
          if (countWithheld && withholdable && isWithheld(body)) { skipped = true; return }
          check(body, raw)
        })
        withheld ||= skipped
        return skipped
      } }
      try {
        await runScenario(ctx, item, language)
        result[key] = item.expectedGap ? 'gap-closed' : 'passed'
      } catch (error) {
        if (!item.expectedGap) throw error
        result[key] = 'known-gap'
        knownGaps[key] = error.message
        continue
      }
      if (!item.expectedGap && ['namedRecord', 'followUp', 'nonEnglish', 'summaryHandoff', 'importContinuation'].includes(name)) {
        tally.total += 1
        if (withheld) tally.withheld += 1
      }
    }
  }
  if (countWithheld && tally.total > 0) {
    const rate = tally.withheld / tally.total
    result.withholdRate = `${tally.withheld}/${tally.total}`
    requireValue(rate <= config.maxWithholdRate, `scenario withhold rate ${result.withholdRate} exceeds the configured maximum`)
  }
  if (Object.keys(knownGaps).length) result.knownGaps = knownGaps
}

// Cheap session pre-flight: an empty query is rejected after authentication and before any model call,
// so 401 means the cookie expired and 400 means it signed in.
export async function preflightSessions(env, fetcher = fetch) {
  return checkSessions(readChatFixtures(env), fetcher)
}

async function checkSessions({ origin, config }, fetcher) {
  const seen = new Set()
  const sessions = [['fresh', config.fresh], ['upgraded', config.upgraded], ['journal', config.journal],
    ...Object.entries(config).filter(([name]) => name in scenarioRunners && name !== 'nonEnglish'),
    ...Object.entries(config.nonEnglish ?? {}).map(([language, fixture]) => [`nonEnglish ${language}`, fixture])]
  for (const [label, session] of sessions) {
    if (!session) continue
    const credential = session[acceptanceBearer] ? session.companyId : session.cookie
    if (seen.has(credential)) continue
    seen.add(credential)
    const response = await requestChat(origin, fetcher, label, session, '')
    await response.arrayBuffer().catch(() => null)
    requireValue(response.status !== 401, session[acceptanceBearer]
      ? `${label} registry session is expired or invalid`
      : `${label} session cookie is expired or invalid; sign in the acceptance user again and replace its cookie in AI_CHAT_ACCEPTANCE_JSON`)
    requireValue(response.status === 400, `${label} session pre-flight returned HTTP ${response.status}`)
  }
}

export async function verifyGroundedChat(env, fetcher = fetch) {
  return verifyFixtures(readChatFixtures(env), fetcher)
}

async function verifyFixtures({ origin, config }, fetcher) {
  const result = {}
  for (const cohort of cohorts) {
    const fixture = config[cohort]
    const response = await requestChat(origin, fetcher, cohort, fixture, fixture.question)
    await checkStream(response, cohort, body => verifyGroundedReply(body, fixture))
    result[cohort] = 'passed'
  }
  const { journal } = config
  if (journal) {
    const response = await requestChat(origin, fetcher, 'journal', journal, journal.question, journalContext)
    await checkStream(response, 'journal', body => verifyJournalReply(body, journal))
    result.journal = 'passed'
    if (journal.ambiguous) {
      const { question, expectedClarificationText } = journal.ambiguous
      const ambiguous = await requestChat(origin, fetcher, 'ambiguous journal', journal, question, journalContext)
      await checkStream(ambiguous, 'ambiguous journal', body => {
        verifyUngroundedReply(body)
        requireValue(hasFact(body.answer, expectedClarificationText), 'journal lookup did not ask for clarification')
      })
      result.ambiguousJournal = 'passed'
    }
    if (journal.foreign) {
      const { foreign } = journal
      const response = await requestChat(origin, fetcher, 'foreign journal', journal, foreign.question, {
        ...journalContext, entity_type: 'account_move', entity_id: recordId(foreign.accountMoveId), explicit_record: true,
      })
      await checkForeignJournal(response, foreign)
      result.foreignJournal = 'passed'
    }
  }
  await runScenarios(origin, fetcher, config, result)
  return result
}

export async function runAcceptanceCheck(env, stage, {
  fetcher = fetch, wait = pause, onPending = () => {}, now = Date.now,
} = {}) {
  requireValue(['preflight', 'verify', 'nightly'].includes(stage), 'unknown chat acceptance stage')
  const source = env.AI_CHAT_ACCEPTANCE_SOURCE || 'legacy'
  requireValue(['legacy', 'registry'].includes(source), 'AI_CHAT_ACCEPTANCE_SOURCE must be legacy or registry')
  const context = source === 'registry'
    ? await readRegistryFixtures(env, stage, { fetcher, wait, onPending, now })
    : readChatFixtures(env)
  if (stage !== 'preflight' || source === 'registry') await checkSessions(context, fetcher)
  if (stage !== 'preflight') return verifyFixtures(context, fetcher)
}

function writeSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const rows = Object.entries(result).filter(([, value]) => typeof value === 'string').map(([name, value]) => `| ${name} | ${value} |`)
  const gaps = Object.entries(result.knownGaps ?? {}).map(([name, reason]) => `- Known gap \`${name}\`: ${reason}`)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Grounded chat acceptance', '', '| Check | Result |', '| --- | --- |', ...rows, '', ...gaps, ''].join('\n'))
}

function recordPendingFixture(releaseSha, activationProof) {
  const message = [
    `Waiting up to 15 minutes for the fresh grounded chat fixture for ${releaseSha}.`,
    'Create and index the fresh test fixture on this deployment, then register the release manifest with this activationProof.',
    `activationProof: ${activationProof}`,
  ].join('\n')
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Fresh grounded chat fixture pending\n\n${message}\n\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stage = { '--check-config': 'preflight', '--nightly': 'nightly' }[process.argv[2]]
    ?? (process.argv[2] === undefined ? 'verify' : null)
  runAcceptanceCheck(process.env, stage, { onPending: recordPendingFixture }).then(result => {
    if (!result) return
    console.log(JSON.stringify(result))
    writeSummary(result)
  }).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
