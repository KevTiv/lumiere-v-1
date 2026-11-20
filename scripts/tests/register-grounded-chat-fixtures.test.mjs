import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { registerGroundedChatFixtures } from '../register-grounded-chat-fixtures.mjs'

test('validates the cutover signature and creation dates before freezing the exact manifest', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const env = { AI_CHAT_ACCEPTANCE_PROOF_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) }
  const release = 'a'.repeat(40)
  const cutover = Date.now() * 1000 - 500_000
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const payload = `${part({ alg: 'EdDSA' })}.${part({
    iss: 'lumiere-acceptance-cutover-v1',
    aud: 'lumiere-grounded-chat-acceptance',
    organization_id: 41,
    environment: 'production',
    release_sha: release,
    observed_at_micros: cutover,
  })}`
  const activationProof = `${payload}.${sign(null, Buffer.from(payload), privateKey).toString('base64url')}`
  const directory = await mkdtemp(join(tmpdir(), 'acceptance-registration-'))
  const calls = []
  let documentCreatedAt = cutover - 1
  const connect = () => ({
    async sql(statement) {
      return statement.includes('FROM company')
        ? [{ created_at: [cutover + 1] }]
        : [{ create_date: { __timestamp_micros_since_unix_epoch__: documentCreatedAt } }]
    },
    async call(...args) { calls.push(args) },
  })
  try {
    const path = join(directory, 'fixtures.json')
    const fixtures = { fresh: { companyId: 30, documentId: 11 }, activationProof }
    await writeFile(path, JSON.stringify(fixtures))
    const args = ['41', 'production', release, path]
    await assert.rejects(registerGroundedChatFixtures(args, env, connect), /created after/)
    await assert.rejects(registerGroundedChatFixtures(['42', ...args.slice(1)], env, connect), /invalid for this tenant/)
    assert.equal(calls.length, 0)

    documentCreatedAt = cutover + 1
    await registerGroundedChatFixtures(args, env, connect)
    assert.deepEqual(calls, [[
      'register_ai_chat_acceptance_fixture', [41, 'production', release, JSON.stringify(fixtures)],
    ]])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
