#!/usr/bin/env node
// Run with a native platform-superuser credential from a private operator environment.
import { readFile } from 'node:fs/promises'
import { createPublicKey, verify } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { platformClient } from './configure-ai-platform.mjs'

function activationTime(proof, org, environment, release, publicKey) {
  const invalid = () => { throw new Error('Cutover receipt is invalid for this tenant and release') }
  if (typeof proof !== 'string' || proof.length > 2048 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(proof)) invalid()
  const [header, payload, signature] = proof.split('.')
  let claims
  try {
    const key = createPublicKey(publicKey)
    if (key.asymmetricKeyType !== 'ed25519'
      || JSON.parse(Buffer.from(header, 'base64url')).alg !== 'EdDSA'
      || !verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) invalid()
    claims = JSON.parse(Buffer.from(payload, 'base64url'))
  } catch { invalid() }
  const at = claims?.observed_at_micros
  if (claims?.iss !== 'lumiere-acceptance-cutover-v1' || claims.aud !== 'lumiere-grounded-chat-acceptance'
    || claims.release_sha !== release || claims.organization_id !== org || claims.environment !== environment
    || !Number.isSafeInteger(at) || at <= 0 || at > Date.now() * 1000) invalid()
  return at
}

function micros(value) {
  const scalar = value?.__timestamp_micros_since_unix_epoch__ ?? value?.microsSinceUnixEpoch
    ?? (Array.isArray(value) && value.length === 1 ? value[0] : value)
  const timestamp = Number(scalar)
  return Number.isSafeInteger(timestamp) ? timestamp : 0
}

async function verifyFreshRecords(client, fixture, org, observedAt) {
  const { companyId, documentId } = fixture.fresh ?? {}
  const positiveId = value => Number.isSafeInteger(value) && value > 0
  if (!positiveId(companyId) || !positiveId(documentId)) throw new Error('Fresh company and document IDs are required')
  const [companies, documents] = await Promise.all([
    client.sql(`SELECT created_at FROM company WHERE organization_id = ${org} AND id = ${companyId} LIMIT 1`),
    client.sql(`SELECT create_date FROM document WHERE organization_id = ${org} AND id = ${documentId} LIMIT 1`),
  ])
  if (companies.length !== 1 || documents.length !== 1 || micros(companies[0].created_at) <= observedAt
    || micros(documents[0].create_date) <= observedAt) {
    throw new Error('Fresh company and document must be created after the cutover receipt')
  }
}

export async function registerGroundedChatFixtures(args, env, connect = platformClient) {
  const [organization, environment, revision, path] = args
  const org = Number(organization)
  if (args.length !== 4 || !/^[1-9][0-9]*$/.test(organization ?? '')
    || !Number.isSafeInteger(org) || !['production', 'dev'].includes(environment)
    || (revision !== 'baseline' && !/^[a-f0-9]{40}$/.test(revision))) {
    throw new Error('usage: register-grounded-chat-fixtures.mjs ORGANIZATION production|dev baseline|RELEASE_SHA FIXTURE_JSON_FILE')
  }
  const raw = await readFile(path, 'utf8').catch(() => { throw new Error('Cannot read fixture file') })
  if (Buffer.byteLength(raw) > 32 * 1024) throw new Error('Fixture file exceeds 32 KiB')
  let fixture
  try { fixture = JSON.parse(raw) } catch { throw new Error('Fixture file is invalid JSON') }
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('Fixture file must be a JSON object')
  const release = revision === 'baseline' ? '' : revision
  // The reducer validates credentials, fixture and company scope, current
  // indexed evidence, baseline equality, and exact revision immutability.
  const client = connect({ ...env, STDB_SERVER_TOKEN: env.AI_CHAT_ACCEPTANCE_OPERATOR_STDB_TOKEN })
  if (release) {
    const observedAt = activationTime(fixture.activationProof, org, environment, release, env.AI_CHAT_ACCEPTANCE_PROOF_PUBLIC_KEY)
    await verifyFreshRecords(client, fixture, org, observedAt)
  }
  await client.call('register_ai_chat_acceptance_fixture', [org, environment, release, JSON.stringify(fixture)])
  return release ? 'Release acceptance fixtures registered' : 'Upgraded acceptance baseline registered'
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  registerGroundedChatFixtures(process.argv.slice(2), process.env).then(console.log).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
