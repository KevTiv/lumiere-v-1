import { createInterface } from 'node:readline'

const [provider, scenario, ...args] = process.argv.slice(2)
const session = 'fixture-session'
const turn = 'fixture-turn'
const answer = '{"evidenceId":"fixture-evidence","productIds":["100"]}'
const isAcp = ['antigravity', 'vibe'].includes(provider)

function send(message) {
  process.stdout.write(JSON.stringify(isAcp ? { jsonrpc: '2.0', ...message } : message) + '\n')
}

function result(id, value) {
  send({ id, result: value })
}

function error(id, code) {
  send({ id, error: { code, message: 'private provider diagnostic' } })
}

function notify(method, params) {
  send({ method, params })
}

function codexUpdate(method, args) {
  notify(method, { threadId: session, turnId: turn, ...args })
}

function acpUpdate(update) {
  notify('session/update', { sessionId: session, update })
}

function onCodex(message) {
  const { method, params, id } = message
  switch (method) {
    case 'initialize':
      result(id, { userAgent: 'codex/1.2.3' })
      break
    case 'account/read':
      result(id, scenario === 'sign-in' ? { requiresOpenaiAuth: true } : {
        account: { type: 'chatgpt', planType: 'plus', email: 'fixture-user@example.test' }, requiresOpenaiAuth: true
      })
      break
    case 'account/rateLimits/read':
      result(id, { rateLimits: { primary: { usedPercent: 37 } } })
      break
    case 'thread/start':
    case 'thread/resume':
      if (params.sandbox !== 'read-only' || params.approvalPolicy !== 'never') process.exit(2)
      if (scenario === 'resume' && method !== 'thread/resume') process.exit(2)
      result(id, { thread: { id: session } })
      break
    case 'turn/start': {
      if (scenario === 'disconnect') process.exit(3)
      if (scenario === 'mcp' && (!process.env.LUMIERE_MCP_TOKEN ||
          args.join(' ').includes(process.env.LUMIERE_MCP_TOKEN))) process.exit(2)
      result(id, { turn: { id: turn } })
      codexUpdate('turn/started', { turn: { id: turn } })
      codexUpdate('item/agentMessage/delta', { threadId: 'wrong-thread', delta: 'private event' })
      const tool = { type: 'mcpToolCall', id: 'tool-1', server: 'lumiere', tool: 'read', arguments: { secret: 'private' } }
      codexUpdate('item/started', { item: tool })
      if (scenario === 'cancel') break
      codexUpdate('item/completed', { item: { ...tool, status: 'completed' } })
      codexUpdate('thread/tokenUsage/updated', { tokenUsage: {
        total: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        last: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }
      } })
      codexUpdate('item/completed', { item: { type: 'agentMessage', id: 'message-1', text: answer } })
      codexUpdate('turn/completed', { turn: { id: turn, status: 'completed' } })
      break
    }
    case 'turn/interrupt':
      result(id, {})
      codexUpdate('turn/completed', { turn: { id: turn, status: 'interrupted' } })
      break
  }
}

let promptRequest
function acpFinish() {
  acpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed' })
  acpUpdate({ sessionUpdate: 'usage_update', used: 52, cost: { amount: 0.05, currency: 'USD' } })
  acpUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } })
  result(promptRequest, { stopReason: 'end_turn' })
}

function onAcp(message) {
  if (message.jsonrpc !== '2.0') process.exit(2)
  const { method, params, id } = message
  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: 1,
        agentInfo: { version: '2.3.4' },
        agentCapabilities: {
          ...(scenario !== 'no-resume' ? { loadSession: provider === 'vibe' } : {}),
          sessionCapabilities: { close: {} },
          mcpCapabilities: { http: true }
        }
      })
      break
    case 'session/new':
      if (scenario === 'sign-in') return error(id, -32000)
      if (params.mcpServers?.length &&
          params.mcpServers[0].headers?.[0]?.value !== 'Bearer scoped-fixture-token') process.exit(2)
      result(id, { sessionId: session })
      break
    case 'session/load':
    case 'session/close':
      result(id, {})
      break
    case 'session/prompt':
      if (scenario === 'quota') return error(id, -31001)
      promptRequest = id
      acpUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Checking the tool.' } })
      acpUpdate({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', status: 'in_progress', locations: ['/private/path'] })
      if (scenario === 'cancel') break
      if (scenario === 'permission') {
        send({ id: 'permission-1', method: 'session/request_permission', params: {
          sessionId: session, toolCall: { toolCallId: 'tool-1', kind: 'read', title: '/private/path' },
          options: [
            { kind: 'allow_always', optionId: 'persist' },
            { kind: 'allow_once', optionId: 'once' },
            { kind: 'reject_once', optionId: 'deny' }
          ]
        } })
      } else acpFinish()
      break
    case 'session/cancel':
      result(promptRequest, { stopReason: 'cancelled' })
      break
    default:
      if (id === 'permission-1') {
        if (message.result?.outcome?.optionId !== 'once') process.exit(2)
        acpFinish()
      }
      break
  }
}

if (provider === 'claude') {
  if (args.includes('--version')) {
    console.log('2.1.321 (Claude Code)')
  } else if (args[0] === 'auth') {
    console.log(JSON.stringify({ loggedIn: true, authMethod: 'api_key', email: 'private email' }, null, 2))
  } else {
    if (!args.includes('--restricted') || !process.env.LUMIERE_MCP_TOKEN ||
        args.join(' ').includes(process.env.LUMIERE_MCP_TOKEN)) process.exit(2)
    process.stdin.resume()
    process.stdin.on('end', () => {
      send({ type: 'system', subtype: 'init', session_id: session })
      send({ type: 'assistant', session_id: session, message: {
        content: [{ type: 'tool_use', name: 'mcp__lumiere__read', id: 'tool-1', input: { secret: 'private' } }]
      } })
      send({ type: 'user', session_id: session, message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1' }]
      } })
      send({ type: 'result', subtype: 'success', session_id: session, result: answer,
        total_cost_usd: 0.01, usage: { input_tokens: 11, output_tokens: 6 } })
    })
  }
} else {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', line => (isAcp ? onAcp : onCodex)(JSON.parse(line)))
}
