import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AdapterError } from './stdio.mjs'

const MAX_TEXT = 32_768
const WIRE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

const failures = {
  auth_required: 'Sign in to the local provider on this device.',
  not_installed: 'The provider CLI is unavailable on this device.',
  isolation_required: 'The provider requires a verified local isolation policy.',
  unsupported_mcp: 'The local provider cannot use scoped Lumière tools.',
  unsupported_resume: 'The local provider cannot resume this session.',
  quota_limited: 'The local provider reported a usage limit.',
  provider_failed: 'The local provider did not complete the turn.',
  outcome_unknown: 'The local provider disconnected before confirming the outcome.',
  invalid_lease: 'The local provider received an invalid run.',
  already_running: 'The local provider already owns this attempt or session.',
  answer_missing: 'The local provider returned no answer.'
}

export function failure(code) {
  return { type: 'failed', code, message: failures[code] ?? failures.provider_failed }
}

export function wireId(value) {
  return typeof value === 'string' && WIRE_ID.test(value) ? value : undefined
}

export function usage(emit, scope, metric, value, estimated) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
  if (metric === 'limit_percent' && value > 100) return
  if (metric.endsWith('_tokens') && !Number.isSafeInteger(value)) return
  emit({ type: 'usage', scope, metric, value, ...(estimated ? { estimated } : {}) })
}

export function textBuffer() {
  let chunks = []
  let length = 0
  return {
    add(value) {
      if (typeof value !== 'string') return
      length += value.length
      if (length > MAX_TEXT) throw new AdapterError('provider_failed', 'The local answer is too long.')
      chunks.push(value)
    },
    set(value) {
      chunks = []
      length = 0
      this.add(value)
    },
    value() {
      return chunks.join('')
    }
  }
}

export function candidate(text) {
  return text?.trim() ? { type: 'candidate', text } : failure('answer_missing')
}

function validMcp(toolScope) {
  if (!toolScope) return true
  try {
    const endpoint = new URL(toolScope.url)
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
    const supported = endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && loopback)
    return supported && !endpoint.username && !endpoint.password && !endpoint.hash &&
      typeof toolScope.token === 'string' &&
      /^[a-zA-Z0-9._~+\/=-]{1,4096}$/.test(toolScope.token)
  } catch {
    return false
  }
}

export function makeAdapter({ provider, executable, workDirectory, spawn, isolated, protocol }) {
  const attempts = new Map()
  const cwd = join(workDirectory, provider)

  async function launch(args, options) {
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    return spawn(executable, args, { cwd, ...options })
  }

  function attemptFor(lease) {
    const attempt = attempts.get(lease.attemptId)
    return attempt?.lease.leaseId === lease.leaseId && attempt.lease.runId === lease.runId
      ? attempt
      : undefined
  }

  return {
    async probe() {
      if (!executable) return { provider, state: 'missing', capabilities: [] }
      try {
        const probe = await protocol.probe({ launch, cwd, isolated })
        const capabilities = isolated ? probe.capabilities : []
        return { provider, ...probe, capabilities, state: isolated ? probe.state : 'unavailable' }
      } catch (error) {
        return {
          provider,
          state: isolated && error?.code === 'auth_required' ? 'signInRequired' : 'unavailable',
          capabilities: []
        }
      }
    },
    async startTurn(lease, { signal, emit }) {
      if (!executable) return emit(failure('not_installed'))
      if (!isolated) return emit(failure('isolation_required'))
      if (lease.provider !== provider || typeof lease.prompt !== 'string' || !lease.prompt.trim() ||
          lease.prompt.length > MAX_TEXT || !validMcp(lease.mcp) ||
          (lease.nativeSessionId !== undefined && !wireId(lease.nativeSessionId))) {
        return emit(failure('invalid_lease'))
      }
      if (attempts.has(lease.attemptId) || (lease.nativeSessionId &&
          [...attempts.values()].some(attempt => attempt.lease.nativeSessionId === lease.nativeSessionId))) {
        return emit(failure('already_running'))
      }
      if (signal?.aborted) return emit({ type: 'cancelled' })

      const abort = new AbortController()
      let outbox = Promise.resolve()
      const attempt = {
        lease, cwd, launch, signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
        cancelRequested: false,
        emit(event) {
          outbox = outbox.then(() => emit(event))
          outbox.catch(() => abort.abort())
        }
      }
      attempts.set(lease.attemptId, attempt)
      let result
      try {
        result = await protocol.run(attempt)
      } catch (error) {
        const code = error?.code
        result = failure(Object.hasOwn(failures, code)
          ? code
          : attempt.dispatched ? 'outcome_unknown' : 'provider_failed')
      } finally {
        abort.abort()
        attempts.delete(lease.attemptId)
      }
      await outbox
      await emit(result)
    },
    async cancel(lease) {
      const attempt = attemptFor(lease)
      if (!attempt || attempt.cancelRequested) return false
      attempt.cancelRequested = true
      await attempt.cancel?.()
      return true
    },
    async answerPermission(lease, permissionId, decision) {
      const attempt = attemptFor(lease)
      if (!attempt || attempt.cancelRequested || !['approve', 'deny'].includes(decision)) return false
      return attempt.answerPermission?.(permissionId, decision) ?? false
    }
  }
}
