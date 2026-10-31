#!/usr/bin/env node
/** Real, isolated CI authority: API + PostgreSQL + STDB; no model or fake HTTP authority. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { callStdbReducer } from '../frontend/web/scripts/stdb-http-seed-shared.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiBase = 'http://127.0.0.1:8082'
const stdbBase = 'http://127.0.0.1:3000'
const moduleName = 'lumiere-v1-local-e2e'
const logDir = join(root, '.tmp/guide-lifecycle')
const children = new Set()
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
// Composite operation parameters use the generated SpacetimeDB SATS wire;
// the API encodes flat Option scalars, not nested composite Option fields.
const none = { none: [] }
const some = (value) => ({ some: value })
let temporary
let api
let stdb

export function requireIsolatedCi(env) {
  assert.equal(env.CI, 'true', 'Guide lifecycle requires an isolated CI runner')
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Guide lifecycle is restricted to hosted CI')
  for (const [key, expected] of Object.entries({
    STDB_HOST: stdbBase, LUMIERE_API_SERVER_URL: apiBase,
    STDB_MODULE: moduleName, PG_HOST: '127.0.0.1', PG_DATABASE: 'lumiere',
  })) assert.equal(env[key], expected, `${key} must target the isolated fixture`)
  assert.match(env.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/, 'An exact CI commit is required')
}

// SATS named products require every field, including absent Option values.
// Keep this fixture aligned with the native UpdateRoleParams wire schema.
export function guideRoleUpdateParams(permissions) {
  return { name: none, description: none, permissions: some(permissions), is_active: some(true), metadata: none }
}

// These canonical evidence producers are deliberately not browser operations.
// Seed only this bounded fixture graph through the existing native owner lane;
// human guide saves, nomination and independent review keep their API sessions.
export function guideEvidenceFixtureArguments(reducer, organizationId, data) {
  const parameters = {
    record_ai_evidence_source: ['params'],
    record_ai_evidence_source_version: ['sourceId', 'params'],
    record_ai_evidence_passage: ['params'],
    record_ai_evidence_claim: ['params'],
    record_ai_evidence_decision: ['params'],
    set_ai_evidence_passage_status: ['passageId', 'status'],
    record_ai_evidence_source_change: ['sourceVersionId', 'params'],
  }
  assert.ok(Object.hasOwn(parameters, reducer), 'Only canonical guide evidence fixture producers are admitted')
  assert.ok(Number.isSafeInteger(organizationId) && organizationId > 0, 'Fixture organization must be exact')
  assert.ok(Number.isSafeInteger(data.companyId) && data.companyId > 0, 'Fixture company must be exact')
  const fields = parameters[reducer]
  assert.deepEqual(Object.keys(data).sort(), ['companyId', ...fields].sort(), 'Fixture arguments must match their fixed native producer')
  for (const field of fields.filter((field) => field.endsWith('Id'))) {
    assert.ok(Number.isSafeInteger(data[field]) && data[field] > 0, 'Fixture evidence identity must be exact')
  }
  return [organizationId, data.companyId, ...fields.map((field) => data[field])]
}

async function seedGuideEvidence(env, organizationId, reducer, data) {
  requireIsolatedCi(env)
  await callStdbReducer(stdbBase, moduleName, env.STDB_SERVER_TOKEN, reducer,
    guideEvidenceFixtureArguments(reducer, organizationId, data))
}

export function guideInspectionFixtureGrantArguments(organizationId, roleId) {
  assert.ok(Number.isSafeInteger(organizationId) && organizationId > 0, 'Fixture organization must be exact')
  assert.ok(Number.isSafeInteger(roleId) && roleId > 0, 'Fixture inspector role must be exact')
  // Exactly the existing read-only owner-baseline capability and its bounds.
  return [organizationId, roleId, 'ai.evidence.inspect', 100, 1024 * 1024, true]
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, 'close')
  process.kill(-child.pid, 'SIGTERM')
  const forced = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 5_000)
  try { await closed } finally { clearTimeout(forced); children.delete(child) }
}

async function start(command, args, env, name) {
  const log = await open(join(logDir, `${name}.log`), 'a', 0o600)
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] })
  children.add(child)
  child.once('error', () => { child.startupFailed = true })
  await log.close()
  return child
}

async function command(command, args, env, timeout = 120_000, capture = false) {
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] })
  children.add(child)
  let output = ''
  if (capture) child.stdout.on('data', (chunk) => { output += chunk })
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, timeout)
  try {
    const [code] = await once(child, 'close')
    assert.equal(code, 0, `${command} failed; lifecycle acceptance did not complete`)
    return output.trim()
  } finally { clearTimeout(timer); children.delete(child) }
}

async function ready(url, child, method = 'GET') {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.startupFailed || child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture service exited before readiness')
    try { if ((await fetch(url, { method, signal: AbortSignal.timeout(2_000) })).ok) return } catch {}
    await delay(1_000)
  }
  throw new Error(`Fixture readiness timed out: ${new URL(url).pathname}`)
}

async function request(path, actor, data, expected = 200) {
  const response = await fetch(`${apiBase}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(actor ? { Cookie: actor.cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(20_000),
  })
  assert.equal(response.status, expected, `Unexpected status for ${path.split('?')[0]}`)
  return response.json()
}

async function login(email) {
  const response = await fetch(`${apiBase}/v1/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123$' }), signal: AbortSignal.timeout(20_000),
  })
  assert.equal(response.status, 200, 'Fixture password authentication failed')
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0])
  const values = Object.fromEntries(cookies.map((cookie) => [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)]))
  assert.ok(values.stdb_token && values.stdb_identity, 'Actual session cookies are required')
  return { cookie: cookies.join('; '), token: values.stdb_token, identity: values.stdb_identity }
}

const operation = (actor, name, data) => request(`/v1/operations/erp.${name}`, actor, data)
const guidePath = (id, company, revision) => `/v1/knowledge/guides/${id}?${new URLSearchParams({ companyId: String(company), ...(revision ? { revision: String(revision) } : {}) })}`

async function probe(fixture, env) {
  const path = join(temporary, 'authority.json')
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 })
  await command('python3', ['scripts/run-required-cargo-tests.py', '--locked', '-p', 'ai-gateway', '--bin', 'gateway',
    'real_authority_guides_lifecycle', '--', '--ignored', '--nocapture'], { ...env, GUIDE_LIVE_FIXTURE: path }, 120_000)
}

async function nativeFixtureId(env, table, clause) {
  assert.match(table, /^ai_evidence_(source|source_version|passage|claim|decision)$/)
  const response = await fetch(`${stdbBase}/v1/database/${moduleName}/sql`, { method: 'POST',
    headers: { Authorization: `Bearer ${env.STDB_SERVER_TOKEN}`, 'Content-Type': 'text/plain' },
    body: `SELECT id FROM ${table} WHERE ${clause} LIMIT 2`, signal: AbortSignal.timeout(10_000) })
  assert.equal(response.status, 200, 'Isolated native fixture read must succeed')
  const result = await response.json()
  const rows = result[0]?.rows
  assert.equal(rows?.length, 1, 'Exactly one native evidence fixture row is required')
  const id = Number(rows[0][0])
  assert.ok(Number.isSafeInteger(id) && id > 0, 'Fixture identity must be exact')
  return id
}

async function verificationLifecycle(admin, ordinary, financeRole, adminRole, companyId, fixture, env) {
  const org = fixture.orgId
  const unique = `guide-review-${randomBytes(6).toString('hex')}`
  await operation(admin, 'update_role', { roleId: Number(financeRole.id), params: guideRoleUpdateParams([
    ...financeRole.permissions, 'knowledge_article:*', 'ai_evidence_claim:update', 'ai_evidence_decision:update', 'ai_knowledge_review:update',
  ]) })
  ordinary = await login('fixture.finance@example.test')
  assert.notEqual(ordinary.identity, admin.identity, 'Guide reviews require an independent authenticated person')
  assert.notEqual(ordinary.token, env.STDB_SERVER_TOKEN, 'Human reviews must not use the native fixture owner')
  const body = 'Review the current bill and its evidence before posting.'
  const hash = createHash('sha256').update(body).digest('hex')
  const source = { companyId, params: { source_kind: 'policy', source_key: unique,
    title: 'Bill review policy', author_attribution: 'known', authors: ['Isolated guide acceptance reviewer'], author_organization: none, scope: 'company', retention_policy: 'hash_only' } }
  await request('/v1/operations/erp.record_ai_evidence_source', admin, source, 403)
  await seedGuideEvidence(env, org, 'record_ai_evidence_source', source)
  const sourceId = await nativeFixtureId(env, 'ai_evidence_source', `organization_id = ${org} AND company_id = ${companyId} AND source_key = '${unique}'`)
  await seedGuideEvidence(env, org, 'record_ai_evidence_source_version', { companyId, sourceId, params: { version: '1', edition: none,
    publication_date_micros: none, uri: none, retrieved_at_micros: none, content_hash: some(hash), snapshot_ref: none,
    origin: 'erp_policy', verification: 'inspected', supersedes_version_id: none } })
  const sourceVersionId = await nativeFixtureId(env, 'ai_evidence_source_version', `organization_id = ${org} AND source_id = ${sourceId}`)
  await seedGuideEvidence(env, org, 'record_ai_evidence_passage', { companyId, params: { source_kind: 'policy', source_key: unique,
    source_version: '1', passage_key: 'bill-checks', passage_text: body, effective_from_micros: none, effective_to_micros: none,
    applicability: ['module:accounting'], source_version_id: some(sourceVersionId), coordinates: ['section:bill-checks'], text_origin: 'original', processor_ref: none } })
  const passageId = await nativeFixtureId(env, 'ai_evidence_passage', `organization_id = ${org} AND source_key = '${unique}'`)
  await seedGuideEvidence(env, org, 'record_ai_evidence_claim', { companyId, params: { kind: 'sourced_fact', statement: body,
    supporting_passage_ids: [passageId], contradicting_passage_ids: [], calculation_ref: none, assumptions: [], contribution_id: none,
    verification_method: 'none', verification_outcome: 'unverified', verification_note: none, supersedes_claim_id: none } })
  const claimId = await nativeFixtureId(env, 'ai_evidence_claim', `organization_id = ${org} AND company_id = ${companyId} AND statement = '${body}'`)
  await request('/v1/ai/evidence/reviews', ordinary, { companyId, kind: 'claim', id: claimId, outcome: 'supported', note: 'Checked the exact isolated policy passage.' })
  await seedGuideEvidence(env, org, 'record_ai_evidence_decision', { companyId, params: { title: unique, adopted_claim_ids: [claimId], supporting_claim_ids: [],
    applicability: ['module:accounting'], alternatives: [], adaptations: [], assumptions: [], rationale: 'Apply the reviewed bill checks before posting.', contribution_id: none, supersedes_decision_id: none } })
  const decisionId = await nativeFixtureId(env, 'ai_evidence_decision', `organization_id = ${org} AND company_id = ${companyId} AND title = '${unique}'`)
  await request('/v1/ai/evidence/reviews', ordinary, { companyId, kind: 'decision', id: decisionId, outcome: 'accepted', note: 'Reviewed the linked, supported policy claim.' })
  const draft = { companyId: String(companyId), requestKey: `${unique}-save`, draftKey: unique, title: 'Current bill checks', module: 'accounting', markdown: body, language: 'en',
    sources: [{ kind: 'passage', trust: 'persisted', passage_id: passageId, source_kind: 'policy', source_key: unique, label: 'Bill review policy' }] }
  const saved = (await request('/v1/knowledge/guides', admin, draft)).guide
  await operation(admin, 'add_article_member', { articleId: Number(saved.guideId), member: { __identity__: `0x${ordinary.identity.replace(/^0x/, '')}` } })
  const evidence = { companyId: String(companyId), revision: 1, sourcePassageIds: [String(passageId)], claimIds: [String(claimId)], decisionIds: [String(decisionId)] }
  const choicesPath = `/v1/knowledge/guides/${saved.guideId}/verification?companyId=${companyId}&revision=1`
  await request(choicesPath, ordinary, undefined, 403)
  await request(choicesPath, admin, undefined, 403)
  // The fixture's admin RBAC role is distinct from the production owner role;
  // wildcard RBAC does not imply an AI evidence-inspection capability grant.
  requireIsolatedCi(env)
  await callStdbReducer(stdbBase, moduleName, env.STDB_SERVER_TOKEN, 'set_ai_capability_role_grant',
    guideInspectionFixtureGrantArguments(org, Number(adminRole.id)))
  await request(choicesPath, ordinary, undefined, 403)
  const choices = await request(choicesPath, admin)
  assert.ok(choices.choices.some((choice) => choice.decisionId === String(decisionId) && choice.sourceLabels.includes('Bill review policy')), 'The authorized picker must offer named canonical evidence')
  let candidate = (await request(`/v1/knowledge/guides/${saved.guideId}/verification`, admin, evidence)).guide
  const retried = (await request(`/v1/knowledge/guides/${saved.guideId}/verification`, admin, evidence)).guide
  assert.equal(retried.reviewEvidence.versionId, candidate.reviewEvidence.versionId, 'Nomination retries must not create another candidate')
  assert.equal(candidate.reviewState, 'draft')
  await request(`/v1/knowledge/guides/${saved.guideId}/reviews`, admin, { companyId: String(companyId), revision: 1, reviewKind: 'source_fidelity', outcome: 'accepted' }, 422)
  for (const reviewKind of ['source_fidelity', 'domain_interpretation', 'implementation']) {
    candidate = (await request(`/v1/knowledge/guides/${saved.guideId}/reviews`, ordinary, { companyId: String(companyId), revision: 1, reviewKind, outcome: 'accepted', note: 'Reviewed the exact saved guide revision and canonical evidence.' })).guide
    assert.equal(candidate.reviewState, reviewKind === 'implementation' ? 'verified' : 'draft')
  }
  const key = `guide:${saved.guideId}:revision:1`
  await probe({ ...fixture, verificationKey: key, expectReusable: true }, env)
  await operation(admin, 'remove_article_member', { articleId: Number(saved.guideId), member: { __identity__: `0x${admin.identity.replace(/^0x/, '')}` } })
  await request(guidePath(saved.guideId, companyId, 1), admin, undefined, 404)
  await probe({ ...fixture, verificationKey: key, expectReusable: false }, env)
  await operation(ordinary, 'add_article_member', { articleId: Number(saved.guideId), member: { __identity__: `0x${admin.identity.replace(/^0x/, '')}` } })
  await probe({ ...fixture, verificationKey: key, expectReusable: true }, env)
  const revised = (await request('/v1/knowledge/guides', admin, { ...draft, guideId: saved.guideId, expectedRevision: 1, requestKey: `${unique}-revise`, markdown: `${body}\nRecheck the current period.` })).guide
  assert.equal(revised.reviewState, 'draft')
  const historical = (await request(guidePath(saved.guideId, companyId, 1), admin)).guide
  assert.equal(historical.reviewEvidence.state, 'needs_review')
  assert.equal(historical.reviewEvidence.reviewEpoch, candidate.reviewEvidence.reviewEpoch + 1)
  await probe({ ...fixture, verificationKey: key, expectReusable: false }, env)
  await request(`/v1/knowledge/guides/${saved.guideId}/verification`, admin, { ...evidence, revision: 2 })
  for (const reviewKind of ['source_fidelity', 'domain_interpretation', 'implementation']) await request(`/v1/knowledge/guides/${saved.guideId}/reviews`, ordinary, { companyId: String(companyId), revision: 2, reviewKind, outcome: 'accepted' })
  const revisedKey = `guide:${saved.guideId}:revision:2`
  await probe({ ...fixture, verificationKey: revisedKey, expectReusable: true }, env)
  await seedGuideEvidence(env, org, 'set_ai_evidence_passage_status', { companyId, passageId, status: 'withdrawn' })
  assert.equal((await request(guidePath(saved.guideId, companyId, 2), admin)).guide.reviewState, 'needs_review', 'Direct legacy passage changes must not leave a false verified badge')
  await probe({ ...fixture, verificationKey: revisedKey, expectReusable: false }, env)
  await seedGuideEvidence(env, org, 'record_ai_evidence_source_change', { companyId, sourceVersionId, params: { change_kind: 'superseded', replacement_version_id: none, reason: 'The isolated source changed; previous guide reviews must be invalidated.' } })
  const stale = (await request(guidePath(saved.guideId, companyId, 2), admin)).guide
  assert.equal(stale.reviewState, 'needs_review')
  await probe({ ...fixture, verificationKey: revisedKey, expectReusable: false }, env)
  console.log('[guide-lifecycle] Actual nomination, independent reviews, revision/source invalidation and revocation accepted.')
}

async function main() {
  requireIsolatedCi(process.env)
  await mkdir(logDir, { recursive: true })
  temporary = await mkdtemp(join(tmpdir(), 'guide-authority-'))
  const env = { ...process.env, LUMIERE_E2E: '1', E2E_PREBUILT: '1',
    STDB_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('hex'), PORT: '8082',
    CORS_ORIGINS: apiBase, DEV_MOCK_ORG_ID: '', STDB_TOKEN_PREFLIGHT_VERIFIED: '1',
    E2E_STDB_HOST: stdbBase, NEXT_PUBLIC_STDB_HOST: stdbBase, NEXT_PUBLIC_STDB_MODULE: moduleName,
    E2E_FIRST_ORG_PERSONA_PASSWORD: 'Password123$',
  }
  // Refuse existing listeners: this harness never kills/reuses somebody else's stack.
  for (const url of [apiBase, stdbBase]) {
    let occupied = false
    try { await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) }); occupied = true } catch {}
    assert.equal(occupied, false, 'A fixture port is already occupied')
  }
  await command('bash', ['scripts/e2e-ci-artifact.sh', 'verify', env.GITHUB_SHA], env)
  stdb = await start('spacetime', ['start', '--listen-addr', '127.0.0.1:3000'], env, 'spacetime')
  await ready(`${stdbBase}/v1/identity`, stdb, 'POST')
  await command('node', ['scripts/e2e-local-stdb-token.mjs', '--login-only'], env)
  await command('spacetime', ['publish', moduleName, '--bin-path', 'spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm', '--server', 'local', '--no-config', '-y'], env)
  env.STDB_SERVER_TOKEN = await command('node', ['scripts/e2e-local-stdb-token.mjs'], env, 30_000, true)
  assert.ok(env.STDB_SERVER_TOKEN, 'Fixture owner credential is required')
  await command('node', ['frontend/web/scripts/e2e-seed-fixture.mjs'], env)
  await command('spacetime', ['call', moduleName, 'run_knowledge_guide_tests', '--server', 'local', '--no-config'], env)
  await command(join(root, '.ci/e2e-build/bin/storage-migrate'), [], env)
  api = await start(join(root, '.ci/e2e-build/bin/api-server'), [], env, 'api-server')
  await ready(`${apiBase}/health/ready`, api)
  await command('node', ['frontend/web/scripts/seed-test-user.mjs', '--all-personas'], env)

  let admin = await login('test@email.com')
  const reader = await login('fixture.reader@example.test')
  const session = await request('/v1/session/field-access', admin)
  const companies = (await request('/v1/query/companies', admin)).data
  const company = companies.find((row) => row.code === 'LTI')
  assert.ok(company, 'Exact seeded company is required')
  const companyId = Number(company.id)
  const keyword = `guide-lifecycle-${randomBytes(6).toString('hex')}`
  const draft = { companyId: String(companyId), requestKey: 'create-guide', draftKey: keyword,
    title: keyword, module: 'accounting', markdown: 'Original immutable instructions.', language: 'en', sources: [] }
  const first = (await request('/v1/knowledge/guides', admin, draft)).guide
  assert.equal(first.revision, 1)
  assert.equal(first.markdown, draft.markdown)
  const retried = (await request('/v1/knowledge/guides', admin, draft)).guide
  assert.equal(retried.guideId, first.guideId)
  assert.equal(retried.revision, 1)
  await request('/v1/knowledge/guides', admin, { ...draft, markdown: 'Changed retry payload' }, 409)
  const update = { ...draft, requestKey: 'revise-guide', guideId: first.guideId, expectedRevision: 1, markdown: 'Second immutable instructions.' }
  const second = (await request('/v1/knowledge/guides', admin, update)).guide
  assert.equal(second.revision, 2)
  await request('/v1/knowledge/guides', admin, { ...update, requestKey: 'stale-edit', markdown: 'Must never replace revision two' }, 409)
  assert.equal((await request(guidePath(first.guideId, companyId, 1), admin)).guide.markdown, draft.markdown)
  assert.equal((await request(guidePath(first.guideId, companyId), admin)).guide.markdown, update.markdown)
  const history = (await request(`/v1/knowledge/guides/${first.guideId}/history?companyId=${companyId}`, admin)).guides
  assert.deepEqual(history.map((guide) => guide.revision), [2, 1])
  await request(guidePath(first.guideId, companyId, 2), null, undefined, 401)
  await request(guidePath(first.guideId, companyId, 2), reader, undefined, 403)

  // The same organization-wide administrator may select another live company,
  // but the guide itself must never bleed into the other company's read scope.
  await operation(admin, 'create_company', { params: { name: 'Guide acceptance company B', code: 'GUIDE-CI-B',
    currency_id: Number(company.currencyId ?? company.currency_id), fiscal_year_end_month: 12, fiscal_year_end_day: 31,
    is_parent: false, parent_id: none, tax_id: none, company_registry: none, address_street: none,
    address_city: none, address_zip: none, address_country_code: none, metadata: none } })
  const otherCompany = (await request('/v1/query/companies', admin)).data.find((row) => row.code === 'GUIDE-CI-B')
  assert.ok(otherCompany, 'Second company creation must be observed')
  const otherCompanyId = Number(otherCompany.id)
  await request(guidePath(first.guideId, otherCompanyId, 2), admin, undefined, 404)
  const otherGuide = (await request('/v1/knowledge/guides', admin, { ...draft, companyId: String(otherCompanyId), requestKey: 'company-b-guide', title: 'Separate company instructions' })).guide
  assert.equal(otherGuide.companyId, String(otherCompanyId))
  const roles = (await request('/v1/query/roles', admin)).data
  const financeRole = roles.find((role) => role.name === 'fixture-finance-accounting')
  assert.ok(financeRole && Array.isArray(financeRole.permissions), 'Exact ordinary-member role is required')
  const adminRole = roles.find((role) => role.name === 'admin')
  assert.ok(adminRole && Array.isArray(adminRole.permissions) && adminRole.permissions.includes('*:*'), 'Exact fixture administrator role is required')
  await operation(admin, 'update_role', { roleId: Number(financeRole.id),
    params: guideRoleUpdateParams([...financeRole.permissions, 'knowledge_article:*']) })
  const ordinary = await login('fixture.finance@example.test')
  const own = (await request('/v1/knowledge/guides', ordinary, { ...draft, requestKey: 'ordinary-own-guide', title: 'Ordinary member instructions' })).guide
  assert.equal(own.companyId, String(companyId))
  await request('/v1/knowledge/guides', ordinary, { ...draft, companyId: String(otherCompanyId), requestKey: 'bound-member-cross-company' }, 403)
  await request(guidePath(first.guideId, companyId, 2), ordinary, undefined, 404)

  const chatKey = `guide-${randomBytes(8).toString('hex')}`
  await operation(admin, 'create_ai_chat_session', { companyId, params: { session_key: chatKey, title: some('Guide lifecycle'),
    route: some('/accounting'), module: some('accounting'), active_tab: none, archived: false, metadata: none } })
  const metadata = { guideSchemaVersion: 1, guideReferences: [{ guideId: first.guideId, revision: 2 }] }
  await operation(admin, 'append_ai_chat_message', { companyId, params: { session_key: chatKey, role: 'assistant',
    content: 'Saved guide reference', sources_json: none, ui_context_json: none, model: none, duration_ms: none,
    status: 'complete', metadata: some(JSON.stringify(metadata)) } })
  const receipt = (await request('/v1/query/ai-chat-messages', admin)).data.find((row) => (row.sessionKey ?? row.session_key) === chatKey)
  assert.deepEqual(JSON.parse(receipt.metadata), metadata)
  const freshChatKey = `fresh-${randomBytes(8).toString('hex')}`
  await operation(admin, 'create_ai_chat_session', { companyId, params: { session_key: freshChatKey, title: some('Fresh conversation'),
    route: some('/accounting'), module: some('accounting'), active_tab: none, archived: false, metadata: none } })
  assert.equal((await request('/v1/query/ai-chat-messages', admin)).data.filter((row) => (row.sessionKey ?? row.session_key) === freshChatKey).length, 0)

  const fixture = { apiBase, orgId: session.organizationId, companyId, otherCompanyId,
    guideId: first.guideId, revision: 2, query: keyword,
    token: admin.token, identity: admin.identity, deniedToken: reader.token, deniedIdentity: reader.identity,
    nonMemberToken: ordinary.token, nonMemberIdentity: ordinary.identity }
  await verificationLifecycle(admin, ordinary, financeRole, adminRole, companyId, fixture, env)
  await probe(fixture, env)
  // No republish, reseed or migration between shutdown and reconnect. A fresh
  // API process and STDB process must reconstruct the same actual saved rows.
  await stop(api)
  await stop(stdb)
  stdb = await start('spacetime', ['start', '--listen-addr', '127.0.0.1:3000'], env, 'spacetime')
  await ready(`${stdbBase}/v1/identity`, stdb, 'POST')
  api = await start(join(root, '.ci/e2e-build/bin/api-server'), [], env, 'api-server')
  await ready(`${apiBase}/health/ready`, api)
  admin = await login('test@email.com')
  assert.equal((await request(guidePath(first.guideId, companyId, 1), admin)).guide.markdown, draft.markdown)
  assert.equal((await request(guidePath(first.guideId, companyId, 2), admin)).guide.markdown, update.markdown)
  const reloaded = (await request('/v1/query/ai-chat-messages', admin)).data.find((row) => (row.sessionKey ?? row.session_key) === chatKey)
  assert.deepEqual(JSON.parse(reloaded.metadata), metadata)
  await probe({ ...fixture, token: admin.token, identity: admin.identity }, env)
  await operation(admin, 'remove_article_member', { articleId: Number(first.guideId), member: { __identity__: `0x${admin.identity.replace(/^0x/, '')}` } })
  await request(guidePath(first.guideId, companyId, 2), admin, undefined, 404)
  await probe({ ...fixture, token: admin.token, identity: admin.identity, revoked: true }, env)
  await writeFile(join(logDir, 'result.json'), JSON.stringify({ schemaVersion: 1, commit: env.GITHUB_SHA,
    accepted: true, checks: ['authenticated-save-reload', 'idempotency', 'immutable-history', 'stale-edit-conflict',
      'company-boundary', 'denied-access', 'persisted-conversation-reference', 'fresh-request-discovery',
      'api-and-stdb-restart', 'revoked-membership'] }, null, 2))
  console.log('[guide-lifecycle] Real authenticated guide lifecycle accepted.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const interrupted = () => {
    void Promise.allSettled([...children].map(stop)).finally(() => process.exit(1))
  }
  process.once('SIGTERM', interrupted)
  process.once('SIGINT', interrupted)
  try { await main() } catch (error) {
    console.error(error instanceof Error ? error.message : 'Guide lifecycle failed')
    process.exitCode = 1
  } finally {
    const stopped = await Promise.allSettled([...children].map(stop))
    if (stopped.some((result) => result.status === 'rejected')) {
      console.error('Guide lifecycle fixture cleanup failed')
      process.exitCode = 1
      await rm(join(logDir, 'result.json'), { force: true })
    }
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
