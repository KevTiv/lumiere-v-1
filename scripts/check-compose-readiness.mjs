#!/usr/bin/env node

const DEFAULT_API = 'http://127.0.0.1:8082/health/ready'
const DEFAULT_AI = 'http://127.0.0.1:8080/health/ready'

export function parseArgs(argv) {
  const values = { api: DEFAULT_API, ai: DEFAULT_AI, timeoutMs: 3000, probes: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--api' || arg === '--ai' || arg === '--timeout-ms' || arg === '--probe') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      if (arg === '--api') values.api = value
      else if (arg === '--ai') values.ai = value
      else if (arg === '--timeout-ms') values.timeoutMs = Number(value)
      else {
        const separator = value.indexOf('=')
        const name = value.slice(0, separator)
        const endpoint = value.slice(separator + 1)
        if (separator < 1 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
          throw new Error('--probe must use NAME=URL with a safe name')
        }
        values.probes.push({ name, endpoint })
      }
    } else if (arg === '--help' || arg === '-h') {
      values.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!Number.isInteger(values.timeoutMs) || values.timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  for (const [name, value] of [
    ['--api', values.api],
    ['--ai', values.ai],
    ...values.probes.map(({ name, endpoint }) => [`--probe ${name}`, endpoint]),
  ]) {
    let url
    try { url = new URL(value) } catch { throw new Error(`${name} must be an absolute URL`) }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use http or https`)
  }
  return values
}

export async function probe(name, endpoint, timeoutMs, fetchFn = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(endpoint, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    console.log(`[readiness] ${name}: ready (${response.status})`)
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message
    throw new Error(`${name} is not ready: ${reason}`)
  } finally {
    clearTimeout(timer)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log('Usage: check-compose-readiness.mjs [--api URL] [--ai URL] [--probe NAME=URL]... [--timeout-ms N]')
      process.exit(0)
    }
    await Promise.all([
      probe('api-server', options.api, options.timeoutMs),
      probe('ai-gateway', options.ai, options.timeoutMs),
      ...options.probes.map(({ name, endpoint }) => probe(name, endpoint, options.timeoutMs)),
    ])
  } catch (error) {
    console.error(`[readiness] ${error.message}`)
    process.exitCode = 1
  }
}
