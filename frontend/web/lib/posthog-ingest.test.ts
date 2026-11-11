import assert from 'node:assert/strict'
import test from 'node:test'
import { posthogIngestRequest } from './posthog-ingest'

const token = 'phc_test_project_token'

test('forwards capture transport headers and strips ERP credentials', () => {
  const url = new URL('https://erp.example.test/ingest/i/v0/e/?v=1')
  const headers = new Headers({
    authorization: 'Bearer erp-session-token',
    cookie: 'stdb_token=private',
    'content-encoding': 'gzip',
    'content-type': 'application/octet-stream',
    'x-stdb-identity': 'private',
    referer: 'https://erp.example.test/accounting/private',
  })
  const upstream = posthogIngestRequest(url, { method: 'POST', headers }, { token })
  assert.equal(upstream?.url.href, 'https://eu.i.posthog.com/i/v0/e/?v=1')
  assert.deepEqual(Object.fromEntries(upstream?.headers ?? []), {
    'content-encoding': 'gzip',
    'content-type': 'application/octet-stream',
    host: 'eu.i.posthog.com',
  })

  headers.set('authorization', `Bearer ${token}`)
  const authenticated = posthogIngestRequest(url, { method: 'POST', headers }, { token })
  assert.equal(authenticated?.headers.get('authorization'), `Bearer ${token}`)
})

test('serves the regional asset host and rejects arbitrary upstream paths', () => {
  const config = { token, ingestHost: 'https://us.i.posthog.com', assetsHost: '' }
  const request = { method: 'GET', headers: new Headers() }
  const asset = new URL('https://erp.example.test/ingest/static/array.js')
  assert.equal(posthogIngestRequest(asset, request, config)?.url.host, 'us-assets.i.posthog.com')
  assert.equal(posthogIngestRequest(asset, request, {}), null)
  assert.equal(posthogIngestRequest(asset, request, { ...config, assetsHost: 'http://example.test' }), null)

  const managementPath = new URL('https://erp.example.test/ingest/api/projects')
  assert.equal(posthogIngestRequest(managementPath, request, config), null)
  assert.equal(posthogIngestRequest(managementPath, { ...request, method: 'POST' }, config), null)
})
