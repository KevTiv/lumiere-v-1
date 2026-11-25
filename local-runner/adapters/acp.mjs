import { candidate, failure, textBuffer, usage, wireId } from './adapter.mjs'
import { AdapterError, rpcPeer } from './stdio.mjs'

const ACP_VERSION = 1
const AUTH_REQUIRED = -32000
const VIBE_USAGE_LIMIT = -31001
const MAX_PERMISSION_OPTIONS = 12
const CLIENT_INFO = { name: 'lumiere_runner', title: 'Lumière runner', version: '1.0.0' }

function version(value) {
  return typeof value === 'string' ? /\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?/.exec(value)?.[0] : undefined
}

function mcpServers(scope, capabilities) {
  if (!scope) return []
  if (!capabilities.mcpCapabilities?.http) {
    throw new AdapterError('unsupported_mcp', 'The ACP agent cannot use scoped HTTP tools.')
  }
  return [{
    type: 'http',
    name: 'lumiere',
    url: scope.url,
    headers: [{ name: 'Authorization', value: `Bearer ${scope.token}` }]
  }]
}

function continuationMethod(capabilities) {
  if (capabilities.sessionCapabilities?.resume) return 'session/resume'
  if (capabilities.loadSession) return 'session/load'
  return undefined
}

function errorType(error, provider) {
  if (error?.code === AUTH_REQUIRED) return 'auth_required'
  if (provider === 'vibe' && error?.code === VIBE_USAGE_LIMIT) return 'quota_limited'
  return undefined
}

export function acpProtocol(provider, args) {
  async function connect(launch, signal, notifications) {
    const child = await launch(args, { signal })
    return rpcPeer(child, { jsonRpcVersion: '2.0', ...notifications })
  }

  async function initialize(peer) {
    const result = await peer.request('initialize', {
      protocolVersion: ACP_VERSION,
      clientCapabilities: {},
      clientInfo: CLIENT_INFO
    })
    if (result?.protocolVersion !== ACP_VERSION) {
      throw new AdapterError('provider_failed', 'The installed agent uses an unsupported ACP version.')
    }
    return result
  }

  return {
    async probe({ launch, cwd, isolated }) {
      const abort = new AbortController()
      try {
        const peer = await connect(launch, abort.signal)
        const hello = await initialize(peer)
        const agentVersion = version(hello.agentInfo?.version)
        const capabilities = hello.agentCapabilities ?? {}
        const supported = ['permission', 'usage']
        if (continuationMethod(capabilities)) supported.push('resume')
        if (capabilities.mcpCapabilities?.http) supported.push('mcp')
        let state = 'unavailable'
        if (isolated) {
          try {
            const session = await peer.request('session/new', { cwd, mcpServers: [] })
            state = wireId(session?.sessionId) ? 'ready' : 'unavailable'
            if (state === 'ready' && capabilities.sessionCapabilities?.close) {
              await peer.request('session/close', { sessionId: session.sessionId }).catch(() => {})
            }
          } catch (error) {
            const code = errorType(error, provider)
            if (code === 'auth_required') state = 'signInRequired'
            if (code === 'quota_limited') state = 'quotaLimited'
          }
        }
        return { ...(agentVersion ? { version: agentVersion } : {}), state, funding: 'unknown', capabilities: supported }
      } finally {
        abort.abort()
      }
    },
    async run(attempt) {
      const { lease, cwd, launch, signal, emit } = attempt
      const answer = textBuffer()
      const permissions = new Map()
      let sessionId
      let peer
      let permissionSequence = 0
      let cancellationSent = false

      function resolvePermission(permissionId, decision) {
        const permission = permissions.get(permissionId)
        if (!permission) return false
        const optionId = decision === 'approve' ? permission.allow : permission.deny
        const outcome = optionId
          ? { outcome: 'selected', optionId }
          : { outcome: 'cancelled' }
        permissions.delete(permissionId)
        peer.reply(permission.id, { outcome })
        emit({ type: 'permissionResolved', permissionId })
        return true
      }

      function onRequest(method, params, id) {
        if (method !== 'session/request_permission') {
          peer.deny(id)
          return
        }
        const options = Array.isArray(params?.options) ? params.options.slice(0, MAX_PERMISSION_OPTIONS) : []
        const allow = wireId(options.find(option => option?.kind === 'allow_once')?.optionId)
        const deny = wireId(options.find(option => option?.kind === 'reject_once')?.optionId)
        if (!attempt.dispatched || attempt.cancelRequested || params?.sessionId !== sessionId ||
            params.toolCall?.kind !== 'read' || !allow || permissions.size > 0) {
          const outcome = deny ? { outcome: 'selected', optionId: deny } : { outcome: 'cancelled' }
          peer.reply(id, { outcome })
          return
        }
        const permissionId = `acp-${++permissionSequence}`
        permissions.set(permissionId, { id, allow, deny })
        emit({ type: 'permission', permissionId, label: 'Allow a read in this agent session?' })
      }

      function onNotify(method, params) {
        if (method !== 'session/update' || !attempt.dispatched || params?.sessionId !== sessionId) return
        const update = params.update
        switch (update?.sessionUpdate) {
          case 'agent_message_chunk':
            if (update.content?.type === 'text') answer.add(update.content.text)
            break
          case 'tool_call':
          case 'tool_call_update':
            if (update.sessionUpdate === 'tool_call') answer.set('')
            if (wireId(update.toolCallId)) {
              const status = update.status
              emit({
                type: 'tool', toolId: update.toolCallId, name: 'Local agent tool',
                status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
              })
            }
            break
          case 'usage_update':
            usage(emit, 'context', 'context_tokens', update.used)
            if (update.cost?.currency === 'USD') usage(emit, 'session', 'cost_usd', update.cost.amount)
            break
        }
      }

      peer = await connect(launch, signal, { onNotify, onRequest })
      attempt.answerPermission = resolvePermission
      attempt.cancel = () => {
        if (!attempt.dispatched || cancellationSent) return
        cancellationSent = true
        peer.notify('session/cancel', { sessionId })
        for (const [permissionId, permission] of permissions) {
          peer.reply(permission.id, { outcome: { outcome: 'cancelled' } })
          emit({ type: 'permissionResolved', permissionId })
        }
        permissions.clear()
      }

      try {
        const hello = await initialize(peer)
        const capabilities = hello.agentCapabilities ?? {}
        const params = { cwd, mcpServers: mcpServers(lease.mcp, capabilities) }
        if (lease.nativeSessionId) {
          const method = continuationMethod(capabilities)
          if (!method) return failure('unsupported_resume')
          sessionId = lease.nativeSessionId
          await peer.request(method, { ...params, sessionId })
        } else {
          const response = await peer.request('session/new', params)
          sessionId = wireId(response?.sessionId)
        }
        if (!sessionId) return failure('provider_failed')
        emit({ type: 'session', nativeSessionId: sessionId })
        if (attempt.cancelRequested) return { type: 'cancelled' }
        emit({ type: 'activity', message: 'The local agent started a turn.' })
        attempt.dispatched = true
        const result = await peer.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: lease.prompt }]
        }, null)
        switch (result?.stopReason) {
          case 'end_turn':
            return candidate(answer.value())
          case 'cancelled':
            return { type: 'cancelled' }
          default:
            return failure('provider_failed')
        }
      } catch (error) {
        const code = errorType(error, provider)
        if (code) return failure(code)
        throw error
      }
    }
  }
}
