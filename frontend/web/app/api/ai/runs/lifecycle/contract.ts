type JsonObject = Record<string, unknown>

const KINDS = ['inspect', 'ask', 'reply', 'steer', 'interrupt', 'resume', 'fork', 'compare'] as const
const HASH = /^[a-fA-F0-9]{64}$/

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function exactKeys(value: JsonObject, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= max ? normalized : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, 2_000)
  if (depth >= 4) return undefined
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1))
  const item = record(value)
  if (!item) return undefined
  const result: JsonObject = {}
  for (const [key, child] of Object.entries(item).slice(0, 100)) {
    if (!/^[\w.:-]{1,120}$/.test(key)) continue
    const safe = sanitizeValue(child, depth + 1)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

function sanitizeRecord(value: unknown): JsonObject | null {
  const safe = sanitizeValue(value)
  return record(safe)
}

function continuation(value: unknown): JsonObject | null {
  const item = record(value)
  if (!item || !exactKeys(item, ['runId', 'checkpointHash', 'cursor', 'concurrencyVersion'])) return null
  const runId = positiveInteger(item.runId)
  const cursor = nonnegativeInteger(item.cursor)
  const concurrencyVersion = positiveInteger(item.concurrencyVersion)
  const checkpointHash = typeof item.checkpointHash === 'string' && HASH.test(item.checkpointHash)
    ? item.checkpointHash.toLowerCase()
    : null
  return runId === null || cursor === null || concurrencyVersion === null || !checkpointHash
    ? null
    : { runId, checkpointHash, cursor, concurrencyVersion }
}

export function parseLifecycleBrowserBody(value: unknown): { companyId: number; intent: JsonObject } | null {
  const root = record(value)
  if (!root || !exactKeys(root, ['companyId', 'intent'])) return null
  const companyId = positiveInteger(root.companyId)
  const raw = record(root.intent)
  if (companyId === null || !raw || !KINDS.includes(raw.kind as typeof KINDS[number])) return null
  const kind = raw.kind as typeof KINDS[number]

  if (kind === 'inspect') {
    if (!exactKeys(raw, ['kind', 'runId'])) return null
    const runId = positiveInteger(raw.runId)
    return runId === null ? null : { companyId, intent: { kind, runId } }
  }

  if (kind === 'compare') {
    if (!exactKeys(raw, ['kind', 'continuation', 'rightRunId', 'right', 'idempotencyKey'])) return null
    const checked = continuation(raw.continuation)
    const right = continuation(raw.right)
    const rightRunId = positiveInteger(raw.rightRunId)
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    return checked && right && rightRunId !== null && right.runId === rightRunId && idempotencyKey
      ? { companyId, intent: { kind, continuation: checked, rightRunId, right, idempotencyKey } }
      : null
  }

  if (!exactKeys(raw, intentKeys(kind))) return null
  const checked = continuation(raw.continuation)
  if (!checked) return null
  if (kind === 'resume') {
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    return idempotencyKey ? { companyId, intent: { kind, continuation: checked, idempotencyKey } } : null
  }
  if (kind === 'interrupt') {
    const reason = boundedText(raw.reason, 2_000)
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    return reason && idempotencyKey ? { companyId, intent: { kind, continuation: checked, reason, idempotencyKey } } : null
  }
  if (kind === 'steer') {
    const instruction = boundedText(raw.instruction, 2_000)
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    return instruction && idempotencyKey ? { companyId, intent: { kind, continuation: checked, instruction, idempotencyKey } } : null
  }
  if (kind === 'ask') {
    const questionKey = boundedText(raw.questionKey, 200)
    const prompt = boundedText(raw.prompt, 32_000)
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    const responseSchemaJson = sanitizeRecord(raw.responseSchemaJson)
    return questionKey && prompt && idempotencyKey && responseSchemaJson && typeof raw.required === 'boolean'
      ? { companyId, intent: { kind, continuation: checked, questionKey, prompt, responseSchemaJson, required: raw.required, idempotencyKey } }
      : null
  }
  if (kind === 'reply') {
    const questionId = positiveInteger(raw.questionId)
    const expectedQuestionRevision = positiveInteger(raw.expectedQuestionRevision)
    const idempotencyKey = boundedText(raw.idempotencyKey, 200)
    const answer = sanitizeRecord(raw.answer)
    return questionId !== null && expectedQuestionRevision !== null && idempotencyKey && answer
      ? { companyId, intent: { kind, continuation: checked, questionId, expectedQuestionRevision, answer, idempotencyKey } }
      : null
  }
  const forkKey = boundedText(raw.forkKey, 200)
  const childRunKey = boundedText(raw.childRunKey, 200)
  const idempotencyKey = boundedText(raw.idempotencyKey, 200)
  return forkKey && childRunKey && idempotencyKey
    ? { companyId, intent: { kind, continuation: checked, forkKey, childRunKey, idempotencyKey } }
    : null
}

export function buildGatewayLifecycleRequest(
  parsed: { companyId: number; intent: JsonObject },
  authority: { organizationId: number; actorIdentity: string; stdbToken: string },
) {
  const runId = parsed.intent.kind === 'inspect'
    ? parsed.intent.runId as number
    : (parsed.intent.continuation as JsonObject).runId as number
  return {
    headers: {
      'x-lumiere-organization-id': String(authority.organizationId),
      'x-lumiere-company-id': String(parsed.companyId),
      'x-lumiere-actor-identity': authority.actorIdentity,
      'x-lumiere-actor-token': authority.stdbToken,
    },
    body: { companyId: parsed.companyId, runId, intent: gatewayIntent(parsed.intent) },
  }
}

function gatewayContinuation(value: unknown) {
  const item = value as JsonObject
  return { run_id: item.runId, checkpoint_hash: item.checkpointHash, cursor: item.cursor, concurrency_version: item.concurrencyVersion }
}

function gatewayIntent(intent: JsonObject): JsonObject {
  const kind = intent.kind
  if (kind === 'inspect') return { kind: 'view' }
  const checked = gatewayContinuation(intent.continuation)
  const idempotency_key = intent.idempotencyKey
  if (kind === 'resume') return { kind, continuation: checked, idempotency_key }
  if (kind === 'interrupt') return { kind, continuation: checked, reason: intent.reason, idempotency_key }
  if (kind === 'steer') return { kind, continuation: checked, instruction: intent.instruction, idempotency_key }
  if (kind === 'ask') return { kind, continuation: checked, question_key: intent.questionKey, prompt: intent.prompt, response_schema_json: JSON.stringify(intent.responseSchemaJson), required: intent.required, idempotency_key }
  if (kind === 'reply') return { kind, continuation: checked, question_id: intent.questionId, expected_question_revision: intent.expectedQuestionRevision, answer: intent.answer, idempotency_key }
  if (kind === 'fork') return { kind, continuation: checked, fork_key: intent.forkKey, child_run_key: intent.childRunKey, idempotency_key }
  return { kind: 'compare', continuation: checked, right_run_id: intent.rightRunId, right: gatewayContinuation(intent.right), idempotency_key }
}

function intentKeys(kind: Exclude<typeof KINDS[number], 'inspect' | 'compare'>): string[] {
  const base = ['kind', 'continuation']
  if (kind === 'resume') return [...base, 'idempotencyKey']
  if (kind === 'interrupt') return [...base, 'reason', 'idempotencyKey']
  if (kind === 'steer') return [...base, 'instruction', 'idempotencyKey']
  if (kind === 'ask') return [...base, 'questionKey', 'prompt', 'responseSchemaJson', 'required', 'idempotencyKey']
  if (kind === 'reply') return [...base, 'questionId', 'expectedQuestionRevision', 'answer', 'idempotencyKey']
  return [...base, 'forkKey', 'childRunKey', 'idempotencyKey']
}
