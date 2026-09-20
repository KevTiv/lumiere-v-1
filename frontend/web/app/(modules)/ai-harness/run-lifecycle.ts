export interface ContinuationView {
  runId: number
  checkpointHash: string
  cursor: number
  concurrencyVersion: number
}

export interface RunLifecycleView {
  runId: number
  state: string
  continuation: ContinuationView | null
  questions: Array<{
    id: number
    questionKey: string
    prompt: string
    status: string
    required: boolean
    revision: number
    answered: boolean
  }>
  events: Array<{
    id: number
    eventKind: string
    createdAt: string
    summary: string
  }>
  comparison: null | {
    leftRunId: number
    rightRunId: number
    leftContinuation: ContinuationView
    rightContinuation: ContinuationView
  }
}

export type LifecycleIntent =
  | { kind: 'inspect'; runId: number }
  | { kind: 'ask'; continuation: ContinuationView; questionKey: string; prompt: string; responseSchemaJson: Record<string, unknown>; required: boolean; idempotencyKey: string }
  | { kind: 'reply'; continuation: ContinuationView; questionId: number; expectedQuestionRevision: number; answer: Record<string, unknown>; idempotencyKey: string }
  | { kind: 'steer'; continuation: ContinuationView; instruction: string; idempotencyKey: string }
  | { kind: 'interrupt'; continuation: ContinuationView; reason: string; idempotencyKey: string }
  | { kind: 'resume'; continuation: ContinuationView; idempotencyKey: string }
  | { kind: 'fork'; continuation: ContinuationView; forkKey: string; childRunKey: string; idempotencyKey: string }
  | { kind: 'compare'; continuation: ContinuationView; rightRunId: number; right: ContinuationView; idempotencyKey: string }

const MAX_TEXT = 2_000
const MAX_ITEMS = 100

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function mapContinuation(value: unknown): ContinuationView | null {
  const item = record(value)
  if (!item) return null
  const runId = positiveInteger(item.runId)
  const cursor = nonnegativeInteger(item.cursor)
  const concurrencyVersion = positiveInteger(item.concurrencyVersion)
  const checkpointHash = text(item.checkpointHash, 64)
  if (!runId || cursor === null || !concurrencyVersion || !/^[a-fA-F0-9]{64}$/.test(checkpointHash)) return null
  return { runId, checkpointHash, cursor, concurrencyVersion }
}

export function mapRunLifecycle(payload: unknown): RunLifecycleView | null {
  const root = record(payload)
  if (!root) return null
  const runId = positiveInteger(root.runId)
  if (!runId) return null
  const continuation = root.continuation == null ? null : mapContinuation(root.continuation)
  if (root.continuation != null && !continuation) return null

  const questions = Array.isArray(root.questions) ? root.questions.slice(0, MAX_ITEMS).flatMap((value) => {
    const item = record(value)
    const id = item && positiveInteger(item.id)
    const revision = item && nonnegativeInteger(item.revision)
    if (!item || !id || revision === null) return []
    return [{
      id,
      questionKey: text(item.key, 128),
      prompt: text(item.prompt),
      status: text(item.status, 64),
      required: item.required === true,
      revision,
      // The answer body may contain sensitive user input and is never rendered.
      answered: item.answer !== undefined && item.answer !== null,
    }]
  }) : []

  const events = Array.isArray(root.events) ? root.events.slice(0, MAX_ITEMS).flatMap((value) => {
    const item = record(value)
    const id = item && positiveInteger(item.id)
    if (!item || !id) return []
    return [{
      id,
      eventKind: text(item.kind, 128),
      createdAt: text(item.createdAt, 128),
      summary: [
        nonnegativeInteger(item.fromVersion),
        nonnegativeInteger(item.toVersion),
      ].every((version) => version !== null)
        ? `Version ${item.fromVersion} → ${item.toVersion}; cursor ${nonnegativeInteger(item.cursor) ?? 0}`
        : `Cursor ${nonnegativeInteger(item.cursor) ?? 0}`,
    }]
  }) : []

  const comparisonRoot = record(root.comparison)
  const leftRunId = comparisonRoot && positiveInteger(comparisonRoot.leftRunId)
  const rightRunId = comparisonRoot && positiveInteger(comparisonRoot.rightRunId)
  const leftContinuation = comparisonRoot && mapContinuation(comparisonRoot.leftContinuation)
  const rightContinuation = comparisonRoot && mapContinuation(comparisonRoot.rightContinuation)
  const comparison = leftRunId && rightRunId && leftContinuation && rightContinuation
    ? { leftRunId, rightRunId, leftContinuation, rightContinuation }
    : null

  return {
    runId,
    state: text(root.state, 64) || 'unknown',
    continuation,
    questions,
    events,
    comparison,
  }
}

export function lifecycleRequest(companyId: number, intent: LifecycleIntent) {
  return { companyId, intent }
}
