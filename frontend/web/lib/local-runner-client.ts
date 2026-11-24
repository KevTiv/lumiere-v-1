import {
  applyRunnerEvent,
  initialRunnerActivity,
  InvalidRunnerStream,
  parseRunnerDiscovery,
  parseRunnerIdentity,
  readRunnerEvents,
  type RunnerActivity,
  type RunnerIdentity,
  type RunnerProvider,
} from './local-runner-state'

const base = '/api/ai/local-runner'

class RunnerRequestError extends Error {
  constructor(readonly status: number) {
    super(status === 403 ? 'Local runner access was denied.' : 'Local runner request failed.')
  }
}

export class RunnerDisconnected extends Error {
  constructor() {
    super('Runner disconnected. Reconnect to the existing run to check its outcome.')
  }
}

async function request(path: string, options?: RequestInit) {
  const response = await fetch(base + path, { cache: 'no-store', ...options })
  if (!response.ok) throw new RunnerRequestError(response.status)
  return response
}

async function post(path: string, body: object, signal?: AbortSignal) {
  return request(path, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function discoverRunners(companyId: number, signal: AbortSignal) {
  const response = await request('/devices?companyId=' + companyId, { signal })
  const discovery = parseRunnerDiscovery(await response.json())
  if (!discovery) throw new Error('Invalid local runner discovery response.')
  return discovery
}

export async function issueRunnerPairing(companyId: number, signal?: AbortSignal) {
  const data = await (await post('/pair', { companyId }, signal)).json() as Record<string, unknown> | null
  if (!data || typeof data.code !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{3,127}$/.test(data.code)
    || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt))) {
    throw new Error('Invalid local runner pairing response.')
  }
  const gateway = typeof data.gatewayOrigin === 'string' ? new URL(data.gatewayOrigin) : undefined
  if (gateway && (!['http:', 'https:'].includes(gateway.protocol) || gateway.username || gateway.password || gateway.href !== gateway.origin + '/')) {
    throw new Error('Invalid local runner gateway URL.')
  }
  return { code: data.code, expiresAt: data.expiresAt, gatewayOrigin: gateway?.origin }
}

export async function revokeRunner(companyId: number, deviceId: string, signal?: AbortSignal) {
  await post('/devices/revoke', { companyId, deviceId }, signal)
}

export async function startRunnerTurn(input: {
  companyId: number
  conversationId: string
  requestId: string
  deviceId: string
  provider: RunnerProvider
  prompt: string
}, signal: AbortSignal) {
  try {
    const response = await post('/runs', input, signal)
    const run = parseRunnerIdentity(await response.json())
    if (run) return run
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof RunnerRequestError && [400, 401, 403, 404, 409, 410, 422, 429].includes(error.status)) throw error
  }
  throw new Error('The runner start outcome is unknown. Check the device before sending again.')
}

export async function cancelRunnerTurn(companyId: number, runId: string, signal?: AbortSignal) {
  await post('/runs/' + encodeURIComponent(runId) + '/cancel', { companyId }, signal)
}

export async function answerRunnerPermission(companyId: number, runId: string, permissionId: string,
  decision: 'approve' | 'deny', signal?: AbortSignal) {
  await post('/runs/' + encodeURIComponent(runId) + '/permission', { companyId, permissionId, decision }, signal)
}

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    function abort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function followRunnerTurn(companyId: number, run: RunnerIdentity, signal: AbortSignal,
  onActivity: (activity: RunnerActivity, reconnecting: boolean) => void) {
  let state = initialRunnerActivity()
  const retryDelays = [250, 500, 1000, 2000, 4000]
  let retries = 0
  while (!state.terminal) {
    signal.throwIfAborted()
    const checkpoint = state.cursor
    const path = '/runs/' + encodeURIComponent(run.runId) + '/events?companyId=' + companyId + '&after=' + checkpoint
    try {
      const response = await request(path, { signal, headers: { Accept: 'text/event-stream' } })
      await readRunnerEvents(response, event => {
        signal.throwIfAborted()
        state = applyRunnerEvent(state, event)
        onActivity(state, false)
        return Boolean(state.terminal)
      })
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof InvalidRunnerStream || (error instanceof RunnerRequestError && [400, 401, 403, 404, 410, 422].includes(error.status))) throw error
    }
    if (state.terminal) break
    if (state.cursor > checkpoint) retries = 0
    const retry = retryDelays[retries++]
    if (retry === undefined) throw new RunnerDisconnected()
    onActivity(state, true)
    await delay(retry, signal)
  }
  return state.terminal
}
