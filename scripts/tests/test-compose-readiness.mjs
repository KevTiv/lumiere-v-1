import assert from 'node:assert/strict'
import { parseArgs, probe } from '../check-compose-readiness.mjs'

const defaults = parseArgs([])
assert.equal(defaults.api, 'http://127.0.0.1:8082/health/ready')
assert.equal(defaults.ai, 'http://127.0.0.1:8080/health/ready')
assert.equal(defaults.timeoutMs, 3000)

const custom = parseArgs(['--api', 'https://api.internal/health/ready', '--ai', 'http://ai:8080/health/ready', '--probe', 'workflow=http://workflow:8093/health/ready', '--timeout-ms', '500'])
assert.equal(custom.timeoutMs, 500)
assert.deepEqual(custom.probes, [{ name: 'workflow', endpoint: 'http://workflow:8093/health/ready' }])
assert.throws(() => parseArgs(['--timeout-ms', '0']), /positive integer/)
assert.throws(() => parseArgs(['--api', 'not-a-url']), /absolute URL/)
assert.throws(() => parseArgs(['--ai', 'ftp://ai/health/ready']), /http or https/)
assert.throws(() => parseArgs(['--unknown']), /unknown argument/)
assert.throws(() => parseArgs(['--probe', 'bad name=http://worker/health/ready']), /safe name/)
assert.throws(() => parseArgs(['--probe', 'worker=not-a-url']), /absolute URL/)

await probe('api-server', defaults.api, 50, async () => ({ ok: true, status: 200 }))
await assert.rejects(
  probe('ai-gateway', defaults.ai, 50, async () => ({ ok: false, status: 503 })),
  /ai-gateway is not ready: HTTP 503/,
)
await assert.rejects(
  probe('api-server', defaults.api, 50, async () => { throw new Error('connection refused') }),
  /api-server is not ready: connection refused/,
)
await assert.rejects(
  probe('ai-gateway', defaults.ai, 1, async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })),
  /ai-gateway is not ready: timeout after 1ms/,
)

console.log('compose readiness tests passed')
