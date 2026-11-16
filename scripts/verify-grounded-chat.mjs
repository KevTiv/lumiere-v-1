#!/usr/bin/env node
// Authenticated release acceptance against two dedicated, pre-indexed fixtures.
import { pathToFileURL } from 'node:url'

const requireValue = (condition, message) => { if (!condition) throw new Error(message) }
const positive = value => Number.isSafeInteger(value) && value > 0
const text = value => typeof value === 'string' && value.trim().length > 0
const cohorts = ['fresh', 'upgraded']

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
    requireValue(positive(fixture?.companyId) && positive(fixture?.documentId)
      && text(fixture?.cookie) && /^[\x20-\x7e]+$/.test(fixture.cookie)
      && text(fixture?.sourceVersion) && text(fixture?.question) && text(fixture?.expectedAnswerText),
    `invalid ${cohort} chat fixture`)
  }
  requireValue(config.fresh.companyId !== config.upgraded.companyId, 'chat fixtures must use different companies')
  return { origin: origin.origin, config }
}

export function verifyGroundedReply(body, fixture) {
  requireValue(body.retrieval_degraded === false && text(body.provider) && text(body.model)
    && positive(body.run_id), 'chat did not return a completed provider response with healthy retrieval')
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

export async function verifyGroundedChat(env, fetcher = fetch) {
  const { origin, config } = readChatFixtures(env)
  for (const cohort of cohorts) {
    const fixture = config[cohort]
    let response
    try {
      response = await fetcher(`${origin}/api/ai/rag/stream`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
        headers: { Origin: origin, Cookie: fixture.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: fixture.companyId, query: fixture.question }),
      })
    } catch {
      throw new Error(`${cohort} chat transport failed; inspect the run before retrying`)
    }
    requireValue(response.ok, `${cohort} chat returned HTTP ${response.status}`)
    requireValue(response.headers.get('content-type')?.startsWith('text/event-stream'), `${cohort} chat did not return an event stream`)
    const raw = await response.text().catch(() => null)
    requireValue(raw, `${cohort} chat stream could not be read`)
    try {
      verifyGroundedReply(completedStream(raw), fixture)
    } catch (error) {
      throw new Error(`${cohort} chat: ${error instanceof TypeError ? 'invalid response schema' : error.message}`)
    }
  }
  return { fresh: 'passed', upgraded: 'passed' }
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
