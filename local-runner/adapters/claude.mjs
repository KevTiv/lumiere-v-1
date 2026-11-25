import { candidate, failure, textBuffer, usage, wireId } from './adapter.mjs'
import { AdapterError, deferred, jsonLines } from './stdio.mjs'

async function readOutput(launch, args) {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 5000)
  try {
    const child = await launch(args, { signal: abort.signal })
    const result = deferred()
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      if (output.length + chunk.length > 8192) {
        result.reject(new AdapterError('invalid_frame', 'The local CLI returned too much output.'))
        abort.abort()
      } else {
        output += chunk
      }
    })
    child.stderr.resume()
    child.once('error', () => result.reject(new AdapterError('process_error', 'Could not run the local CLI.')))
    child.once('close', code => result.resolve({ code, output }))
    child.stdin.end()
    return await result.promise
  } finally {
    clearTimeout(timeout)
    abort.abort()
  }
}

function supportedVersion(version) {
  const [major, minor, patch] = (version ?? '').split('.').map(Number)
  return major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 259)))
}

function funding(auth) {
  if (['api_key', 'api_key_helper', 'third_party'].includes(auth?.authMethod)) return 'api'
  if (auth?.authMethod === 'claude.ai' &&
      typeof auth?.subscriptionType === 'string' &&
      !['', 'none', 'unknown'].includes(auth.subscriptionType.toLowerCase())) return 'subscription'
  return 'unknown'
}

export const claudeProtocol = {
  async probe({ launch, isolated }) {
    const versionResult = await readOutput(launch, ['--version'])
    const version = /\d+\.\d+\.\d+/.exec(versionResult.output)?.[0]
    if (!version || !supportedVersion(version) || !isolated) {
      return { ...(version ? { version } : {}), state: 'unavailable', capabilities: [] }
    }
    const status = await readOutput(launch, ['auth', 'status'])
    const auth = JSON.parse(status.output)
    return {
      version, state: status.code === 0 && auth.loggedIn ? 'ready' : 'signInRequired',
      funding: funding(auth), capabilities: ['resume', 'usage', 'mcp']
    }
  },
  async run(attempt) {
    const { lease, launch, signal, emit } = attempt
    const args = [
      '--print', '--restricted', '--strict-mcp-config',
      '--tools', '', '--permission-prompts', 'none',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages'
    ]
    let env
    if (lease.mcp) {
      const config = { mcpServers: {
        lumiere: {
          type: 'http',
          url: lease.mcp.url,
          headers: { Authorization: 'Bearer ${LUMIERE_MCP_TOKEN}' }
        }
      } }
      args.push('--mcp-config', JSON.stringify(config), '--allowedTools', 'mcp__lumiere__*')
      env = { LUMIERE_MCP_TOKEN: lease.mcp.token }
    }
    if (lease.nativeSessionId) args.push('--resume', lease.nativeSessionId)
    const child = await launch(args, { signal, ...(env ? { env } : {}) })
    const completion = deferred()
    const answer = textBuffer()
    const activeTools = new Set()
    let sessionId

    function onMessage(event) {
      if (event?.type === 'system' && event.subtype === 'init') {
        sessionId = wireId(event.session_id)
        if (!sessionId || (lease.nativeSessionId && lease.nativeSessionId !== sessionId)) {
          throw new AdapterError('outcome_unknown', 'The local CLI returned an invalid session.')
        }
        emit({ type: 'session', nativeSessionId: sessionId })
        return
      }
      if (event?.session_id !== sessionId || !sessionId) return
      if (event.type === 'stream_event' && !event.parent_tool_use_id &&
          event.event?.delta?.type === 'text_delta') answer.add(event.event.delta.text)
      if (event.type === 'assistant' || event.type === 'user') {
        const blocks = Array.isArray(event.message?.content) ? event.message.content : []
        for (const block of blocks) {
          if (block?.type === 'tool_use' && typeof block.name === 'string' &&
              block.name.startsWith('mcp__lumiere__') && wireId(block.id)) {
            activeTools.add(block.id)
            emit({ type: 'tool', toolId: block.id, name: 'Lumière ERP tool', status: 'running' })
          }
          if (block?.type === 'tool_result' && activeTools.delete(block.tool_use_id)) {
            emit({
              type: 'tool', toolId: block.tool_use_id, name: 'Lumière ERP tool',
              status: block.is_error ? 'failed' : 'completed'
            })
          }
        }
      }
      if (event.type !== 'result') return
      usage(emit, 'session', 'input_tokens', event.usage?.input_tokens)
      usage(emit, 'session', 'output_tokens', event.usage?.output_tokens)
      usage(emit, 'session', 'cost_usd', event.total_cost_usd, true)
      if (event.subtype === 'success' && !event.is_error) {
        if (typeof event.result === 'string') answer.set(event.result)
        completion.resolve(candidate(answer.value()))
      } else if (event.subtype === 'interrupted') {
        completion.resolve({ type: 'cancelled' })
      } else {
        completion.resolve(failure('provider_failed'))
      }
    }

    jsonLines(child, onMessage, () => completion.resolve(failure('outcome_unknown')))
    attempt.cancel = () => {
      if (attempt.dispatched) child.kill('SIGINT')
    }
    if (attempt.cancelRequested) return { type: 'cancelled' }
    emit({ type: 'activity', message: 'Claude Code started a turn.' })
    attempt.dispatched = true
    child.stdin.end(lease.prompt)
    return completion.promise
  }
}
