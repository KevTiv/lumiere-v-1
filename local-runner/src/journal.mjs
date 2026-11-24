import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isDeviceMessage, isGatewayMessage, providers } from '../protocol/v1.mjs'
import { privateDirectory, readPrivateJson, writePrivateJson } from './private-store.mjs'

const maxAttempts = 4096
const maxSnapshotBytes = 16 * 1024 * 1024
const terminal = new Set(['candidate', 'cancelled', 'failed'])

export function attemptIdentity({ runId, attemptId, leaseId }) {
  return { runId, attemptId, leaseId }
}

export function isTerminalEvent(event) {
  return terminal.has(event.type)
}

export function sameAttempt(left, right) {
  return left.runId === right.runId &&
    left.attemptId === right.attemptId &&
    left.leaseId === right.leaseId
}

function validateAttempt(attempt) {
  if (typeof attempt !== 'object' || attempt === null ||
      !isGatewayMessage({ type: 'cancel', ...attempt.identity }) ||
      (attempt.provider !== undefined && !providers.includes(attempt.provider)) ||
      (attempt.nativeSessionId !== undefined &&
        (typeof attempt.nativeSessionId !== 'string' || attempt.nativeSessionId.length > 512)) ||
      !Number.isSafeInteger(attempt.lastSequence) || attempt.lastSequence < 0 ||
      typeof attempt.settled !== 'boolean' || !Array.isArray(attempt.pending) ||
      !attempt.pending.every((event, index) => isDeviceMessage(event) &&
        event.type === 'event' && sameAttempt(attempt.identity, event) &&
        event.seq <= attempt.lastSequence &&
        (index === 0 || event.seq > attempt.pending[index - 1].seq))) {
    throw new Error('invalid runner journal')
  }
}

export function openJournal({
  directory,
  deviceId,
  maxPendingBytes = 512 * 1024,
  maxPendingEvents = 512,
}) {
  const file = join(privateDirectory(directory), `journal-${createHash('sha256').update(deviceId).digest('hex')}.json`)
  const snapshot = readPrivateJson(file, maxSnapshotBytes)
  if (snapshot !== undefined && (!Array.isArray(snapshot) || snapshot.length > maxAttempts)) {
    throw new Error('invalid runner journal')
  }
  let attempts = new Map()
  let pendingBytes = 0
  let pendingEvents = 0
  for (const attempt of snapshot ?? []) {
    validateAttempt(attempt)
    if (attempts.has(attempt.identity.attemptId)) throw new Error('invalid runner journal')
    attempts.set(attempt.identity.attemptId, attempt)
    pendingEvents += attempt.pending.length
    pendingBytes += attempt.pending.reduce((bytes, event) => bytes + frameBytes(event), 0)
  }

  function frameBytes(message) {
    return Buffer.byteLength(JSON.stringify(message))
  }

  function persist(attempt) {
    const next = new Map(attempts)
    next.set(attempt.identity.attemptId, attempt)
    writePrivateJson(file, [...next.values()])
    attempts = next
  }

  function lookup(identity) {
    const attempt = attempts.get(identity.attemptId)
    if (attempt && !sameAttempt(attempt.identity, identity)) {
      throw new Error('runner attempt identity does not match its recorded lease')
    }
    return attempt
  }

  function claim(identity) {
    if (lookup(identity)) return false
    if (attempts.size >= maxAttempts) throw new Error('runner journal reached its attempt limit')
    persist({
      identity: attemptIdentity(identity),
      provider: identity.provider,
      lastSequence: 0,
      settled: false,
      pending: [],
    })
    return true
  }

  function append(identity, event, { emergency = false } = {}) {
    const attempt = lookup(identity)
    if (!attempt || attempt.settled) throw new Error('runner attempt is not active')
    const message = {
      type: 'event',
      ...attempt.identity,
      seq: attempt.lastSequence + 1,
      event,
    }
    if (!isDeviceMessage(message)) throw new Error('invalid provider event')
    const bytes = frameBytes(message)
    if (!emergency && (pendingEvents >= maxPendingEvents || pendingBytes + bytes > maxPendingBytes)) {
      const error = new Error('runner event buffer is full')
      error.code = 'runner_capacity'
      throw error
    }
    persist({
      ...attempt,
      lastSequence: message.seq,
      settled: isTerminalEvent(event),
      ...(event.type === 'session' && { nativeSessionId: event.nativeSessionId }),
      pending: [...attempt.pending, message],
    })
    pendingEvents++
    pendingBytes += bytes
    return message
  }

  function acknowledge(identity, sequence) {
    const attempt = lookup(identity)
    if (!attempt) return
    if (sequence > attempt.lastSequence) throw new Error('runner received an acknowledgement for an unseen event')
    const acknowledged = attempt.pending.find(event => event.seq === sequence)
    if (!acknowledged) return
    persist({ ...attempt, pending: attempt.pending.filter(event => event.seq !== sequence) })
    pendingEvents--
    pendingBytes -= frameBytes(acknowledged)
  }

  function recoverInterrupted() {
    for (const attempt of attempts.values()) {
      if (!attempt.settled) {
        append(attempt.identity, {
          type: 'failed',
          code: 'outcome_unknown',
          message: 'The runner restarted before confirming how this attempt ended.',
        }, { emergency: true })
      }
    }
  }

  function pending() {
    return [...attempts.values()].flatMap(attempt => attempt.pending)
  }

  function knowsSession(provider, nativeSessionId) {
    return [...attempts.values()].some(attempt =>
      attempt.provider === provider && attempt.nativeSessionId === nativeSessionId)
  }

  return { claim, append, acknowledge, recoverInterrupted, pending, knowsSession }
}
