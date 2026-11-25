export const protocolVersion = 1

export const providers = Object.freeze(['codex', 'claude', 'antigravity', 'vibe'])

const states = ['missing', 'signInRequired', 'ready', 'unavailable', 'quotaLimited']
const capabilities = ['resume', 'permission', 'usage', 'quota', 'mcp']
const funding = ['subscription', 'api', 'unknown']
const usageMetrics = {
  turn: ['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'],
  session: ['input_tokens', 'output_tokens', 'total_tokens', 'cost_usd'],
  context: ['context_tokens'],
  account: ['limit_percent'],
}

export const devicePaths = Object.freeze({
  claim: '/v1/local-runner/pair/claim',
  connect: '/v1/local-runner/device',
  mcp: '/v1/local-runner/mcp',
})

const identityKeys = ['runId', 'attemptId', 'leaseId']

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function shape(value, allowed) {
  return object(value) && Object.keys(value).every(key => allowed.includes(key))
}

function string(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength && value.trim().length > 0
}

function id(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
}

function integer(value, min = 1) {
  return Number.isSafeInteger(value) && value >= min
}

function optional(value, validate) {
  return value === undefined || validate(value)
}

export function isScopedMcp(value) {
  if (!shape(value, ['url', 'token']) || !string(value.url, 2048) ||
      typeof value.token !== 'string' || !/^[A-Za-z0-9._~+\/=-]{1,4096}$/.test(value.token)) {
    return false
  }

  try {
    const url = new URL(value.url)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
  } catch {
    return false
  }
}

function providerStatus(value) {
  return shape(value, ['provider', 'version', 'state', 'capabilities', 'funding']) &&
    providers.includes(value.provider) &&
    states.includes(value.state) &&
    optional(value.version, version => string(version, 128)) &&
    optional(value.funding, mode => funding.includes(mode)) &&
    Array.isArray(value.capabilities) &&
    new Set(value.capabilities).size === value.capabilities.length &&
    value.capabilities.every(capability => capabilities.includes(capability))
}

function usage(value) {
  const metrics = Object.hasOwn(usageMetrics, value.scope) && usageMetrics[value.scope]
  if (!metrics || !metrics.includes(value.metric) || !Number.isFinite(value.value) || value.value < 0) {
    return false
  }

  if (value.metric === 'limit_percent' && value.value > 100) return false
  if (value.metric.endsWith('_tokens') && !integer(value.value, 0)) return false
  return optional(value.estimated, flag => typeof flag === 'boolean')
}

export function isRunnerEvent(value) {
  if (!object(value)) return false

  switch (value.type) {
    case 'activity':
      return shape(value, ['type', 'message']) && string(value.message, 512)
    case 'tool':
      return shape(value, ['type', 'toolId', 'name', 'status']) &&
        string(value.toolId, 256) && string(value.name, 128) &&
        ['running', 'completed', 'failed'].includes(value.status)
    case 'permission':
      return shape(value, ['type', 'permissionId', 'label']) &&
        id(value.permissionId) && string(value.label, 512)
    case 'permissionResolved':
      return shape(value, ['type', 'permissionId']) && id(value.permissionId)
    case 'usage':
      return shape(value, ['type', 'scope', 'metric', 'value', 'estimated']) && usage(value)
    case 'session':
      return shape(value, ['type', 'nativeSessionId']) && string(value.nativeSessionId, 512)
    case 'candidate':
      return shape(value, ['type', 'text']) && string(value.text, 32768)
    case 'cancelled':
      return shape(value, ['type'])
    case 'failed':
      return shape(value, ['type', 'code', 'message']) && id(value.code) && string(value.message, 512)
    default:
      return false
  }
}

function attemptMessage(value, keys = []) {
  return shape(value, ['type', ...identityKeys, ...keys]) &&
    identityKeys.every(key => id(value[key]))
}

export function isDeviceMessage(value) {
  if (!object(value)) return false

  switch (value.type) {
    case 'hello':
      return shape(value, ['type', 'version', 'providers']) &&
        value.version === protocolVersion &&
        Array.isArray(value.providers) &&
        value.providers.length <= providers.length &&
        value.providers.every(providerStatus) &&
        new Set(value.providers.map(({ provider }) => provider)).size === value.providers.length
    case 'event':
      return attemptMessage(value, ['seq', 'event']) && integer(value.seq) && isRunnerEvent(value.event)
    default:
      return false
  }
}

export function isGatewayMessage(value) {
  if (!object(value)) return false

  switch (value.type) {
    case 'dispatch':
      return attemptMessage(value, ['provider', 'prompt', 'nativeSessionId', 'mcp']) &&
        providers.includes(value.provider) && string(value.prompt, 32768) &&
        optional(value.nativeSessionId, session => string(session, 512)) &&
        optional(value.mcp, isScopedMcp)
    case 'ack':
      return attemptMessage(value, ['seq']) && integer(value.seq)
    case 'cancel':
      return attemptMessage(value)
    case 'permissionReply':
      return attemptMessage(value, ['permissionId', 'decision']) &&
        id(value.permissionId) && ['approve', 'deny'].includes(value.decision)
    default:
      return false
  }
}
