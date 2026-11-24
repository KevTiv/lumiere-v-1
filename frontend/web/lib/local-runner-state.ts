export const runnerProviders = ['codex', 'claude', 'antigravity', 'vibe'] as const
export type RunnerProvider = (typeof runnerProviders)[number]
export type RunnerFunding = 'subscription' | 'api' | 'unknown'

const providerStates = ['missing', 'signInRequired', 'ready', 'unavailable', 'quotaLimited'] as const
const usageMetrics = {
  turn: ['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'],
  session: ['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'],
  context: ['context_tokens'],
  account: ['limit_percent'],
} as const

interface ProviderStatus {
  provider: RunnerProvider
  state: (typeof providerStates)[number]
  version?: string
  funding?: RunnerFunding
  capabilities: string[]
}

export interface RunnerDevice {
  deviceId: string
  label: string
  state: 'online' | 'offline'
  providers: ProviderStatus[]
}

export interface RunnerDiscovery {
  enabled: boolean
  devices: RunnerDevice[]
}

export interface RunnerIdentity {
  runId: string
  attemptId: string
}

export interface RunnerReceipt extends RunnerIdentity {
  turnId: string
  prompt: string
  label: string
  funding?: RunnerFunding
}

type Activity = { type: 'activity' | 'reconciling'; message: string }
type Tool = { type: 'tool'; toolId: string; name: string; status: 'running' | 'completed' | 'failed' }
type Permission = { type: 'permission'; permissionId: string; label: string }
type PermissionResolved = { type: 'permissionResolved'; permissionId: string }
type Usage = { type: 'usage'; scope: keyof typeof usageMetrics; metric: string; value: number; estimated?: boolean }
type Verified = { type: 'verified'; answer: string; sources?: unknown[]; run_id?: number }
type Failed = { type: 'failed'; code: string; message: string }
type Cancelled = { type: 'cancelled' }
export type RunnerEvent = { seq: number } & (Activity | Tool | Permission | PermissionResolved | Usage | Verified | Failed | Cancelled)

export interface RunnerActivity {
  cursor: number
  message?: string
  reconciling?: boolean
  tools: Tool[]
  permissions: Permission[]
  usage: Usage[]
  terminal?: Verified | Failed | Cancelled
}

const maxTrackedItems = 12
const maxFrameSize = 256 * 1024
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/

function record(value: unknown) {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function nonempty(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && value.trim().length > 0
}

export function isRunnerId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value)
}

function integer(value: unknown, minimum = 1): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function member<const T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some(choice => choice === value)
}

function funding(value: unknown): value is RunnerFunding {
  return member(value, ['subscription', 'api', 'unknown'])
}

function parseProvider(value: unknown): ProviderStatus | undefined {
  const data = record(value)
  if (!data || !member(data.provider, runnerProviders) || !member(data.state, providerStates)
    || !Array.isArray(data.capabilities) || data.capabilities.length > 12
    || !data.capabilities.every(capability => nonempty(capability, 64))) return
  return { provider: data.provider, state: data.state, capabilities: data.capabilities as string[],
    ...(nonempty(data.version, 128) && { version: data.version }),
    ...(funding(data.funding) && { funding: data.funding }),
  }
}

export function parseRunnerDiscovery(value: unknown): RunnerDiscovery | undefined {
  const data = record(value)
  if (data?.version !== 1 || typeof data.enabled !== 'boolean' || !Array.isArray(data.devices) || data.devices.length > 50) return
  if (!data.enabled) return { enabled: false, devices: [] }
  const devices: RunnerDevice[] = []
  for (const raw of data.devices) {
    const device = record(raw)
    if (!device || !isRunnerId(device.deviceId) || !nonempty(device.label, 128)
      || !member(device.state, ['online', 'offline']) || !Array.isArray(device.providers)
      || device.providers.length > runnerProviders.length || devices.some(existing => existing.deviceId === device.deviceId)) return
    const providers = device.providers.map(parseProvider)
    if (providers.some(provider => !provider) || new Set(providers.map(provider => provider?.provider)).size !== providers.length) return
    devices.push({ deviceId: device.deviceId, label: device.label, state: device.state, providers: providers as ProviderStatus[] })
  }
  return { enabled: true, devices }
}

export function parseRunnerIdentity(value: unknown): RunnerIdentity | undefined {
  const data = record(value)
  if (data && isRunnerId(data.runId) && isRunnerId(data.attemptId)) return { runId: data.runId, attemptId: data.attemptId }
}

export function readRunnerReceipt(storage: Storage, scope: string): RunnerReceipt | undefined {
  try {
    const saved = record(JSON.parse(storage.getItem(scope) ?? 'null'))
    const ids = parseRunnerIdentity(saved)
    if (saved && ids && isRunnerId(saved.turnId) && nonempty(saved.prompt, 8 * 1024) && nonempty(saved.label, 256)) {
      return { ...ids, turnId: saved.turnId, prompt: saved.prompt, label: saved.label,
        ...(funding(saved.funding) && { funding: saved.funding }),
      }
    }
  } catch {
    return
  }
}

export function initialRunnerActivity(): RunnerActivity {
  return { cursor: 0, tools: [], permissions: [], usage: [] }
}

function upsert<T>(items: T[], value: T, matches: (value: T) => boolean) {
  const index = items.findIndex(matches)
  if (index === -1) return [...items.slice(-(maxTrackedItems - 1)), value]
  return items.map((item, offset) => offset === index ? value : item)
}

export function applyRunnerEvent(state: RunnerActivity, event: RunnerEvent): RunnerActivity {
  if (event.seq <= state.cursor) return state
  if (event.seq !== state.cursor + 1 || state.terminal) throw new Error('Invalid local runner event sequence.')
  const next = { ...state, cursor: event.seq }
  switch (event.type) {
    case 'activity':
    case 'reconciling': return { ...next, message: event.message, reconciling: event.type === 'reconciling' }
    case 'tool': return { ...next, tools: upsert(state.tools, event, tool => tool.toolId === event.toolId) }
    case 'permission': return { ...next, permissions: upsert(state.permissions, event, permission => permission.permissionId === event.permissionId) }
    case 'permissionResolved': return { ...next, permissions: state.permissions.filter(permission => permission.permissionId !== event.permissionId) }
    case 'usage': return { ...next, usage: upsert(state.usage, event, usage => usage.scope === event.scope && usage.metric === event.metric) }
    case 'verified':
    case 'failed':
    case 'cancelled': return { ...next, terminal: event, permissions: [], reconciling: false }
  }
}

function parseRunnerEvent(raw: string): RunnerEvent | undefined {
  const value = record(JSON.parse(raw))
  const seq = value?.seq
  if (!value || !integer(seq)) return
  const type = value.type
  switch (type) {
    case 'activity':
    case 'reconciling': if (nonempty(value.message, 512)) return { seq, type, message: value.message }; return
    case 'tool': if (nonempty(value.toolId, 256) && nonempty(value.name, 128) && member(value.status, ['running', 'completed', 'failed'])) {
      return { seq, type, toolId: value.toolId, name: value.name, status: value.status }
    } return
    case 'permission': if (isRunnerId(value.permissionId) && nonempty(value.label, 512)) return { seq, type, permissionId: value.permissionId, label: value.label }; return
    case 'permissionResolved': if (isRunnerId(value.permissionId)) return { seq, type, permissionId: value.permissionId }; return
    case 'usage': {
      const { scope, metric, value: amount, estimated } = value
      if (!member(scope, ['turn', 'session', 'context', 'account']) || !member(metric, usageMetrics[scope])
        || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0
        || (metric === 'limit_percent' && amount > 100) || (metric.endsWith('_tokens') && !integer(amount, 0))
        || (estimated !== undefined && typeof estimated !== 'boolean')) return
      return { seq, type, scope, metric, value: amount, estimated }
    }
    case 'verified': if (nonempty(value.answer, 32768) && (value.sources === undefined || (Array.isArray(value.sources) && value.sources.length <= 100))) {
      return { seq, type, answer: value.answer, sources: value.sources, ...(integer(value.run_id) && { run_id: value.run_id }) }
    } return
    case 'failed': if (isRunnerId(value.code) && nonempty(value.message, 512)) return { seq, type, code: value.code, message: value.message }; return
    case 'cancelled': return { seq, type }
  }
}

export class InvalidRunnerStream extends Error {}

/** A closed stream can be reattached to at the last complete event, never redispatched. */
export async function readRunnerEvents(response: Response, receive: (event: RunnerEvent) => boolean) {
  if (!response.body || response.headers.get('content-type')?.split(';', 1)[0] !== 'text/event-stream') {
    throw new InvalidRunnerStream('Local runner activity was unavailable.')
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const reader = response.body.getReader()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      try {
        pending += decoder.decode(value, { stream: true })
        let boundary = /\r?\n\r?\n/.exec(pending)
        while (boundary) {
          const frame = pending.slice(0, boundary.index)
          pending = pending.slice(boundary.index + boundary[0].length)
          if (frame.length > maxFrameSize) throw new Error('Event too large')
          const message = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, '')).join('\n')
          if (message) {
            const event = parseRunnerEvent(message)
            if (!event) throw new Error('Unknown event')
            if (receive(event)) return
          }
          boundary = /\r?\n\r?\n/.exec(pending)
        }
        if (pending.length > maxFrameSize) throw new Error('Event too large')
      } catch {
        throw new InvalidRunnerStream('Invalid local runner activity.')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
