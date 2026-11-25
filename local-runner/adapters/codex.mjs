import { candidate, failure, textBuffer, usage, wireId } from './adapter.mjs'
import { AdapterError, deferred, rpcPeer } from './stdio.mjs'

const MCP_NAME = 'lumiere'
const CLIENT_INFO = { name: 'lumiere_runner', title: 'Lumière runner', version: '1.0.0' }

function connect(launch, options, notifications) {
  const args = [
    '-c', 'features.shell_tool=false',
    '-c', 'features.apps=false',
    '-c', 'features.plugins=false',
    '-c', 'web_search="disabled"',
    'app-server', '--listen', 'stdio://'
  ]
  const mcp = options.mcp
  const env = mcp ? { LUMIERE_MCP_TOKEN: mcp.token } : undefined
  const mcpConfig = mcp
    ? `{ ${MCP_NAME} = { url = ${JSON.stringify(mcp.url)}, bearer_token_env_var = "LUMIERE_MCP_TOKEN", required = true } }`
    : '{}'
  args.unshift('-c', `mcp_servers=${mcpConfig}`)
  return launch(args, { signal: options.signal, ...(env ? { env } : {}) })
    .then(child => rpcPeer(child, notifications ?? {}))
}

async function initialize(peer) {
  const result = await peer.request('initialize', { clientInfo: CLIENT_INFO })
  peer.notify('initialized')
  return result
}

function accountMode(account) {
  if (account?.type === 'chatgpt' && typeof account.planType === 'string' && !['free', 'unknown'].includes(account.planType)) {
    return 'subscription'
  }
  if (account?.type === 'apiKey' || account?.type === 'amazonBedrock') return 'api'
  return 'unknown'
}

function accountUsage(emit, account) {
  const limits = account?.rateLimitsByLimitId?.codex ?? account?.rateLimits
  const usageRates = [limits?.primary?.usedPercent, limits?.secondary?.usedPercent]
    .filter(value => typeof value === 'number' && Number.isFinite(value))
  if (usageRates.length) usage(emit, 'account', 'limit_percent', Math.max(...usageRates))
}

function codexFailure(error) {
  const info = error?.codexErrorInfo
  if (info === 'usageLimitExceeded' || info?.usageLimitExceeded !== undefined) {
    return failure('quota_limited')
  }
  if (info === 'unauthorized' || info?.unauthorized !== undefined) {
    return failure('auth_required')
  }
  return failure('provider_failed')
}

export const codexProtocol = {
  async probe({ launch }) {
    const abort = new AbortController()
    try {
      const peer = await connect(launch, { signal: abort.signal })
      const setup = await initialize(peer)
      const account = await peer.request('account/read', { refreshToken: false })
      const funding = accountMode(account?.account)
      const version = /\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?/.exec(setup?.userAgent ?? '')?.[0]
      return {
        ...(version ? { version } : {}),
        state: account?.account || account?.requiresOpenaiAuth === false ? 'ready' : 'signInRequired',
        funding,
        capabilities: ['resume', 'permission', 'usage', 'mcp', ...(account?.account?.type === 'chatgpt' ? ['quota'] : [])]
      }
    } finally {
      abort.abort()
    }
  },
  async run(attempt) {
    const { lease, launch, cwd, signal, emit } = attempt
    const completion = deferred()
    const answer = textBuffer()
    const permissions = new Map()
    let latestItem
    let threadId
    let turnId
    let error
    let peer
    let cancelling
    let permissionSequence = 0

    function resolvePermission(permissionId, decision) {
      if (!permissions.has(permissionId)) return false
      const requestId = permissions.get(permissionId)
      permissions.delete(permissionId)
      peer.reply(requestId, { action: decision, content: decision === 'accept' ? {} : null })
      emit({ type: 'permissionResolved', permissionId })
      return true
    }

    function cancel() {
      for (const permissionId of permissions.keys()) resolvePermission(permissionId, 'cancel')
      if (!turnId) return
      cancelling ??= peer.request('turn/interrupt', { threadId, turnId })
      return cancelling
    }

    function onRequest(method, params, id) {
      if (method === 'mcpServer/elicitation/request') {
        const schema = params?.requestedSchema
        if (lease.mcp && params?.serverName === MCP_NAME && params?.threadId === threadId &&
            params?.turnId === turnId && params?.mode === 'form' &&
            schema?.type === 'object' && Object.keys(schema.properties ?? {}).length === 0 &&
            !schema.required?.length && !attempt.cancelRequested && permissions.size === 0) {
          const permissionId = `codex-${++permissionSequence}`
          permissions.set(permissionId, id)
          emit({ type: 'permission', permissionId, label: 'Allow the Lumière tool to continue?' })
          return
        }
        peer.reply(id, { action: 'decline', content: null })
      } else {
        peer.deny(id)
      }
    }

    function onNotify(method, params) {
      if (method === 'account/rateLimits/updated' && attempt.dispatched) {
        accountUsage(emit, params)
        return
      }
      if (!attempt.dispatched || params?.threadId !== threadId) return
      if (params.turnId && turnId && params.turnId !== turnId) return
      switch (method) {
        case 'turn/started':
          turnId ??= wireId(params.turn?.id)
          if (attempt.cancelRequested) void cancel()?.catch(() => {})
          break
        case 'item/agentMessage/delta':
          if (latestItem !== params.itemId) {
            latestItem = params.itemId
            answer.set(params.delta)
          } else {
            answer.add(params.delta)
          }
          break
        case 'item/started':
        case 'item/completed': {
          const item = params.item
          if (item?.type === 'agentMessage' && method === 'item/completed' &&
              typeof item.text === 'string') {
            latestItem = item.id
            answer.set(item.text)
          } else if (item?.type === 'mcpToolCall' && item.server === MCP_NAME && wireId(item.id)) {
            emit({
              type: 'tool', toolId: item.id, name: 'Lumière ERP tool',
              status: method === 'item/started' ? 'running' : item.status === 'failed' ? 'failed' : 'completed'
            })
          }
          break
        }
        case 'thread/tokenUsage/updated': {
          const totals = params.tokenUsage?.total
          usage(emit, 'session', 'input_tokens', totals?.inputTokens)
          usage(emit, 'session', 'output_tokens', totals?.outputTokens)
          usage(emit, 'session', 'total_tokens', totals?.totalTokens)
          usage(emit, 'context', 'context_tokens', params.tokenUsage?.last?.totalTokens)
          break
        }
        case 'serverRequest/resolved':
          for (const [permissionId, requestId] of permissions) {
            if (requestId !== params.requestId) continue
            permissions.delete(permissionId)
            emit({ type: 'permissionResolved', permissionId })
          }
          break
        case 'error':
          if (!params.willRetry) error = params.error
          break
        case 'turn/completed':
          if (turnId && params.turn?.id !== turnId) return
          if (params.turn?.status === 'completed') completion.resolve(candidate(answer.value()))
          else if (params.turn?.status === 'interrupted') completion.resolve({ type: 'cancelled' })
          else completion.resolve(codexFailure(params.turn?.error ?? error))
          break
      }
    }

    peer = await connect(launch, { signal, mcp: lease.mcp }, { onNotify, onRequest })
    attempt.cancel = cancel
    attempt.answerPermission = (permissionId, decision) => resolvePermission(
      permissionId, decision === 'approve' ? 'accept' : 'decline'
    )
    await initialize(peer)
    const account = await peer.request('account/read', { refreshToken: false })
    if (!account?.account && account?.requiresOpenaiAuth !== false) return failure('auth_required')
    if (account.account?.type === 'chatgpt') {
      const limits = await peer.request('account/rateLimits/read', undefined, 2000).catch(() => {})
      accountUsage(emit, limits)
    }
    if (attempt.cancelRequested) return { type: 'cancelled' }

    const scope = { cwd, approvalPolicy: 'never', sandbox: 'read-only' }
    const thread = lease.nativeSessionId
      ? await peer.request('thread/resume', { ...scope, threadId: lease.nativeSessionId, excludeTurns: true })
      : await peer.request('thread/start', scope)
    threadId = wireId(thread?.thread?.id)
    if (!threadId || (lease.nativeSessionId && lease.nativeSessionId !== threadId)) {
      throw new AdapterError('provider_failed', 'The local CLI returned an invalid thread.')
    }
    emit({ type: 'session', nativeSessionId: threadId })
    if (attempt.cancelRequested) return { type: 'cancelled' }

    emit({ type: 'activity', message: 'Codex started a turn.' })
    attempt.dispatched = true
    const start = await peer.request('turn/start', {
      threadId,
      cwd,
      input: [{ type: 'text', text: lease.prompt }]
    })
    turnId ??= wireId(start?.turn?.id)
    if (!turnId) throw new AdapterError('outcome_unknown', 'The local CLI did not return a turn.')
    if (attempt.cancelRequested) void cancel()?.catch(() => {})
    const result = await Promise.race([completion.promise, peer.exited])
    if (result instanceof Error) throw result
    return result
  }
}
