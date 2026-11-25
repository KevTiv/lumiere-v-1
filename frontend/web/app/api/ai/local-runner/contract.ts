import { positiveInteger } from '../_lib/positive-integer'

const providers = new Set(['codex', 'claude', 'antigravity', 'vibe'])
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/
const maxPromptBytes = 8 * 1024

export function localRunnerId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return typeof value === 'string' && idPattern.test(value) ? value : undefined
}

interface GatewayOperation {
  companyId: number
  path: string
  stream?: boolean
  body?: Record<string, unknown>
}

/** Browser values express intent; actor authority and gateway location are server-owned. */
export function localRunnerOperation(
  method: 'GET' | 'POST',
  segments: string[],
  input: Record<string, unknown>,
): GatewayOperation | undefined {
  const companyId = positiveInteger(input.companyId)
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return
  const path = segments.map(encodeURIComponent).join('/')
  if (method === 'GET' && path === 'devices') return { companyId, path: `devices?companyId=${companyId}` }
  if (method === 'POST' && path === 'pair') return { companyId, path, body: { companyId } }

  if (method === 'POST' && path === 'devices/revoke') {
    const deviceId = localRunnerId(input.deviceId)
    if (deviceId) return { companyId, path, body: { companyId, deviceId } }
    return
  }

  if (method === 'POST' && path === 'runs') {
    const deviceId = localRunnerId(input.deviceId)
    const conversationId = localRunnerId(input.conversationId)
    const requestId = localRunnerId(input.requestId)
    const { prompt, provider } = input
    if (!deviceId || !conversationId || !requestId || typeof provider !== 'string' || !providers.has(provider)
      || typeof prompt !== 'string' || !prompt.trim() || new TextEncoder().encode(prompt).length > maxPromptBytes) return
    return { companyId, path, body: { companyId, conversationId, requestId, deviceId, provider, prompt } }
  }

  if (segments.length !== 3 || segments[0] !== 'runs' || !localRunnerId(segments[1])) return
  if (method === 'GET' && segments[2] === 'events') {
    const rawAfter = input.after ?? '0'
    if (typeof rawAfter !== 'string' || !/^\d+$/.test(rawAfter)) return
    const after = Number(rawAfter)
    if (!Number.isSafeInteger(after)) return
    return { companyId, path: `${path}?companyId=${companyId}&after=${after}`, stream: true }
  }

  if (method === 'POST' && segments[2] === 'cancel') return { companyId, path, body: { companyId } }
  if (method === 'POST' && segments[2] === 'permission') {
    const permissionId = localRunnerId(input.permissionId)
    const { decision } = input
    if (permissionId && (decision === 'approve' || decision === 'deny')) {
      return { companyId, path, body: { companyId, permissionId, decision } }
    }
  }
}
