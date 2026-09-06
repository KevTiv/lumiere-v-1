#!/usr/bin/env node
// Check Turbo's actual resolved graph without building or exposing env values.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../frontend/', import.meta.url))
function graph(overrides = {}) {
  const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=my-project', '--dry=json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: '1',
      LUMIERE_API_SERVER_URL: 'http://127.0.0.1:8082',
      NEXT_PUBLIC_STDB_MODULE: 'cache-test-a',
      ...overrides,
    },
  })
  if (result.status !== 0) throw new Error(`Turbo dry run failed: ${result.stderr}`)
  return JSON.parse(result.stdout).tasks
}

const baseline = graph()
const web = baseline.find(task => task.taskId === 'my-project#build')
assert.ok(web, 'web build must be present')
assert.ok(web.outputs.includes('.next/**'), 'production output must be cached')
assert.ok(web.excludedOutputs.includes('.next/cache/**'), 'compiler cache is not a build artifact')
assert.ok(web.excludedOutputs.includes('.next/dev/**'), 'development output must not be restored')
assert.ok(web.resolvedTaskDefinition.inputs.includes('.env*'), 'dotenv files must invalidate the build')

for (const overrides of [
  { LUMIERE_API_SERVER_URL: 'http://127.0.0.1:8083' },
  { NEXT_PUBLIC_STDB_MODULE: 'cache-test-b' },
]) {
  const changed = graph(overrides)
  assert.notEqual(changed.find(task => task.taskId === web.taskId).hash, web.hash,
    'rewrite/public build environment must invalidate web output')
  // Shared UI packages can legitimately infer NEXT_PUBLIC_* through their
  // framework dependencies. The API client has no web build-time environment.
  for (const task of baseline.filter(task => task.taskId === '@lumiere/api-client#build')) {
    assert.equal(changed.find(candidate => candidate.taskId === task.taskId).hash, task.hash,
      `web-only environment must not invalidate ${task.taskId}`)
  }
}
console.log('Frontend build-cache graph: outputs, exclusions, dotenv and environment invalidation passed')
