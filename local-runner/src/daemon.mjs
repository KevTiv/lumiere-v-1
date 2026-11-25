import { setTimeout as delay } from 'node:timers/promises'
import { devicePaths, isDeviceMessage, isGatewayMessage, isRunnerEvent, protocolVersion, providers } from '../protocol/v1.mjs'
import { isTerminalEvent, sameAttempt } from './journal.mjs'

const maxMessageBytes = 256 * 1024
const maxSocketBuffer = 1024 * 1024
const connected = 1

function failed(code, message) {
  return { type: 'failed', code, message }
}

async function providerStatus(adapters) {
  return Promise.all(providers.map(async provider => {
    if (!adapters[provider]) return { provider, state: 'missing', capabilities: [] }
    try {
      const status = await adapters[provider].probe()
      if (status?.provider === provider &&
          isDeviceMessage({ type: 'hello', version: protocolVersion, providers: [status] })) {
        return status
      }
    } catch {
      // Provider diagnostics can contain host paths and credential details.
    }
    return { provider, state: 'unavailable', capabilities: [] }
  }))
}

function attach({
  url, credential, deviceId, WebSocket, signal, statuses, journal, receive, onConnection, ackTimeoutMs,
}) {
  return new Promise(resolve => {
    const socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${credential}`,
        'X-Lumiere-Runner-Device-Id': deviceId,
      },
    })
    const sent = new Set()
    let opened = false
    let ackTimer
    let finished = false
    const connectTimer = setTimeout(() => finish(), 10_000)

    function finish() {
      if (finished) return
      finished = true
      clearTimeout(connectTimer)
      clearTimeout(ackTimer)
      signal?.removeEventListener('abort', finish)
      onConnection(undefined)
      try {
        if (socket.readyState < 2) socket.close()
      } catch {
        // The remote endpoint can close before the local close call.
      }
      resolve(opened)
    }

    function send(message) {
      if (finished || socket.readyState !== connected) return false
      const serialized = JSON.stringify(message)
      if ((socket.bufferedAmount ?? 0) + Buffer.byteLength(serialized) > maxSocketBuffer) {
        finish()
        return false
      }
      try {
        socket.send(serialized)
        return true
      } catch {
        finish()
        return false
      }
    }

    function watchAcknowledgements() {
      if (sent.size === 0) {
        clearTimeout(ackTimer)
        ackTimer = undefined
      } else {
        ackTimer ??= setTimeout(finish, ackTimeoutMs)
      }
    }

    function flush() {
      for (const frame of journal.pending()) {
        const key = `${frame.attemptId}/${frame.seq}`
        if (!sent.has(key)) {
          sent.add(key)
          if (!send(frame)) return
        }
      }
      watchAcknowledgements()
    }

    socket.addEventListener('open', () => {
      clearTimeout(connectTimer)
      if (!send({ type: 'hello', version: protocolVersion, providers: statuses })) return
      opened = true
      onConnection(flush)
      flush()
    })
    socket.addEventListener('message', ({ data }) => {
      if (finished || !opened) return
      try {
        if (typeof data !== 'string' || Buffer.byteLength(data) > maxMessageBytes) throw new Error()
        const message = JSON.parse(data)
        if (!isGatewayMessage(message)) throw new Error()
        if (message.type === 'ack') {
          journal.acknowledge(message, message.seq)
          if (sent.delete(`${message.attemptId}/${message.seq}`)) {
            clearTimeout(ackTimer)
            ackTimer = undefined
            watchAcknowledgements()
          }
        } else {
          receive(message)
        }
      } catch {
        finish()
      }
    })
    socket.addEventListener('close', finish, { once: true })
    socket.addEventListener('error', finish, { once: true })
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

export async function runDaemon({
  adapters, journal, url, credential, deviceId, WebSocket = globalThis.WebSocket, signal,
  reconnectMs = 250, maxReconnectMs = 5_000, ackTimeoutMs = 30_000,
  cancelWaitMs = 10_000, shutdown,
}) {
  journal.recoverInterrupted()
  let active
  let flush
  let fatalError
  const internal = new AbortController()
  const connectionSignal = signal ? AbortSignal.any([signal, internal.signal]) : internal.signal
  const pairedMcpUrl = new URL(devicePaths.mcp, url)
  pairedMcpUrl.protocol = pairedMcpUrl.protocol === 'wss:' ? 'https:' : 'http:'

  function append(dispatch, event, options) {
    journal.append(dispatch, event, options)
    flush?.()
  }

  function fatal(error) {
    fatalError = error
    internal.abort()
  }

  function settle(run, event) {
    if (run.settled) return
    try {
      append(run.dispatch, event, { emergency: event.type === 'failed' })
      clearTimeout(run.cancelTimer)
      run.settled = true
    } catch (error) {
      fatal(error)
      run.controller.abort()
    }
  }

  function start(dispatch, status) {
    if (!journal.claim(dispatch)) return
    if (dispatch.mcp && new URL(dispatch.mcp.url).href !== pairedMcpUrl.href) {
      append(dispatch, failed('invalid_lease', 'The tool endpoint did not match the paired gateway.'), { emergency: true })
      return
    }
    const adapter = adapters[dispatch.provider]
    if (!adapter || status?.state !== 'ready' || (dispatch.mcp && !status.capabilities.includes('mcp'))) {
      append(dispatch, failed('provider_unavailable', 'This provider cannot start the requested turn.'), { emergency: true })
      return
    }
    if (dispatch.nativeSessionId && (!status.capabilities.includes('resume') ||
        !journal.knowsSession(dispatch.provider, dispatch.nativeSessionId))) {
      append(dispatch, failed('native_session_unavailable', 'This session is unavailable on the selected local provider.'), { emergency: true })
      return
    }
    if (active) {
      append(dispatch, failed('runner_busy', 'This runner is already processing another turn.'), { emergency: true })
      return
    }
    const run = { dispatch, adapter, controller: new AbortController(), permissions: new Set(), settled: false }
    active = run

    function emit(event) {
      if (run.settled) return
      if (!isRunnerEvent(event)) throw new Error('invalid provider event')
      try {
        append(dispatch, event)
      } catch (error) {
        if (error.code !== 'runner_capacity') {
          fatal(error)
        } else {
          settle(run, failed('runner_capacity', 'The runner could not store more events while awaiting acknowledgement.'))
        }
        run.controller.abort()
        throw error
      }
      if (event.type === 'permission') run.permissions.add(event.permissionId)
      if (event.type === 'permissionResolved') run.permissions.delete(event.permissionId)
      if (isTerminalEvent(event)) {
        clearTimeout(run.cancelTimer)
        run.settled = true
      }
    }

    async function execute() {
      try {
        await adapter.startTurn(dispatch, { signal: run.controller.signal, emit })
        settle(run, failed('outcome_unknown', 'The provider stopped without reporting a turn outcome.'))
      } catch {
        settle(run, failed('outcome_unknown', 'The provider connection closed before the turn outcome was confirmed.'))
      } finally {
        clearTimeout(run.cancelTimer)
        active = undefined
      }
    }

    void execute().catch(fatal)
  }

  async function cancel(run) {
    if (run.cancelling || run.settled) return
    run.cancelling = true
    function unconfirmedCancellation() {
      if (run.settled) return
      settle(run, failed('outcome_unknown', 'The provider did not confirm cancellation.'))
      run.controller.abort()
    }
    run.cancelTimer = setTimeout(unconfirmedCancellation, cancelWaitMs)
    try {
      if (await run.adapter.cancel?.(run.dispatch)) return
    } catch {
      // The adapter did not confirm cancellation.
    }
    unconfirmedCancellation()
  }

  async function answerPermission(run, message) {
    if (run.settled || !run.permissions.delete(message.permissionId)) return
    try {
      await run.adapter.answerPermission?.(run.dispatch, message.permissionId, message.decision)
    } catch {
      // The adapter keeps ownership of its native permission lifecycle.
    }
  }

  try {
    if (connectionSignal.aborted) return
    const statuses = await providerStatus(adapters)
    const byProvider = new Map(statuses.map(status => [status.provider, status]))
    let backoff = reconnectMs
    while (!connectionSignal.aborted) {
      const opened = await attach({
        url, credential, deviceId, WebSocket, signal: connectionSignal, statuses, journal, ackTimeoutMs,
        onConnection(connection) { flush = connection },
        receive(message) {
          if (message.type === 'dispatch') {
            start(message, byProvider.get(message.provider))
          } else if (active && sameAttempt(active.dispatch, message)) {
            if (message.type === 'cancel') void cancel(active).catch(fatal)
            else void answerPermission(active, message).catch(fatal)
          }
        },
      })
      if (connectionSignal.aborted) break
      if (opened) backoff = reconnectMs
      await delay(backoff, undefined, { signal: connectionSignal }).catch(error => {
        if (error.name !== 'AbortError') throw error
      })
      backoff = Math.min(backoff * 2, maxReconnectMs)
    }
  } finally {
    if (active && !active.settled) {
      settle(active, failed('outcome_unknown', 'The local runner stopped before the provider confirmed the turn outcome.'))
      active?.controller.abort()
    }
    await shutdown?.()
  }
  if (fatalError) throw fatalError
}
