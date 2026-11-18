#!/usr/bin/env node
// Authenticated release acceptance for indexed documents and an optional live journal.
import { pathToFileURL } from 'node:url'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const positive = value => Number.isSafeInteger(value) && value > 0
const text = value => typeof value === 'string' && value.trim().length > 0
const cohorts = ['fresh', 'upgraded']
const journalContext = { route: '/accounting', module: 'accounting', active_tab: 'journal-entries' }

const validSession = fixture => positive(fixture?.companyId)
  && text(fixture?.cookie) && /^[\x20-\x7e]+$/.test(fixture.cookie)
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

export function readChatFixtures(env) {
  let origin, config
  try {
    origin = new URL(env.AI_CHAT_ACCEPTANCE_URL)
    config = JSON.parse(env.AI_CHAT_ACCEPTANCE_JSON)
  } catch {
    throw new Error('configure the chat acceptance URL and fixture secret')
  }
  requireValue(origin.protocol === 'https:' && !origin.username && !origin.password
    && !origin.search && !origin.hash && origin.pathname === '/', 'chat acceptance URL must be an HTTPS origin')
  for (const cohort of cohorts) {
    const fixture = config?.[cohort]
    requireValue(validSession(fixture) && positive(fixture.documentId)
      && text(fixture?.sourceVersion) && text(fixture?.question) && text(fixture?.expectedAnswerText),
    `invalid ${cohort} chat fixture`)
  }
  requireValue(config.fresh.companyId !== config.upgraded.companyId, 'chat fixtures must use different companies')
  if (config.journal !== undefined) validateJournalFixture(config.journal)
  return { origin: origin.origin, config }
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

async function requestChat(origin, fetcher, label, session, query, uiContext) {
  try {
    return await fetcher(`${origin}/api/ai/rag/stream`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
      headers: { Origin: origin, Cookie: session.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: session.companyId, query, ...(uiContext && { ui_context: uiContext }) }),
    })
  } catch {
    throw new Error(`${label} chat transport failed; inspect the run before retrying`)
  }
}

async function checkStream(response, label, check) {
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

async function checkForeignJournal(response, foreign) {
  const noForeignFacts = raw => requireValue(!normalizeText(raw).includes(normalizeText(foreign.forbiddenText)),
    'foreign journal chat exposed the protected test fact')
  if (response.status === 403 || response.status === 404) {
    const raw = await response.text().catch(() => null)
    requireValue(raw !== null, 'foreign journal chat denial could not be read')
    noForeignFacts(raw)
    return
  }
  await checkStream(response, 'foreign journal', (body, raw) => {
    noForeignFacts(raw)
    requireValue(!text(body.answer) || !normalizeText(body.answer).includes(normalizeText(foreign.forbiddenText)),
      'foreign journal chat exposed the protected test fact')
    verifyUngroundedReply(body)
  })
}

export async function verifyGroundedChat(env, fetcher = fetch) {
  const { origin, config } = readChatFixtures(env)
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
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--check-config') {
    try { readChatFixtures(process.env) } catch (error) { console.error(error.message); process.exitCode = 1 }
  } else {
    verifyGroundedChat(process.env).then(result => console.log(JSON.stringify(result))).catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
}
