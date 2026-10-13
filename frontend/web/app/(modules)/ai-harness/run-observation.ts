import type { JsonObject } from '@lumiere/api-client/json-object'

export interface RunObservationView {
  runId: number
  status: string
  stepCount: number
  tokensUsed: number
  transcript: Array<{
    id: number
    stepNo: number
    toolName: string
    inputHash: string | null
    resultSummary: string
    outputRowCount: number | null
    durationMs: number
    error: boolean
  }>
  economics: RunEconomicsView | null
}

export interface RunEconomicsView {
  providerModels: Array<{ provider: string; model: string }>
  providerModelsTruncated: boolean
  attemptCount: number | null
  attemptStatuses: string[]
  reservationStatuses: string[]
  outcomeUnknown: boolean
  inputTokens: number | null
  outputTokens: number | null
  currency: string | null
  reservedUnits: number | null
  settledUnits: number | null
  truncated: boolean
}

const MAX_STEPS = 200

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

const ATTEMPT_STATUSES = new Set(['accepted', 'dispatched', 'succeeded', 'failed', 'outcome_unknown', 'abandoned'])
const RESERVATION_STATUSES = new Set(['reserved', 'settled', 'released'])

export function mapRunEconomics(value: unknown): RunEconomicsView | null {
  const item = record(value)
  if (!item) return null
  const truncated = item.truncated === true
  const optionalCount = (field: unknown) => field == null ? null : nonnegativeInteger(field)
  const attemptCount = optionalCount(item.attemptCount)
  const inputTokens = optionalCount(item.inputTokens)
  const outputTokens = optionalCount(item.outputTokens)
  const reservedUnits = optionalCount(item.reservedUnits)
  const settledUnits = optionalCount(item.settledUnits)
  if ([attemptCount, inputTokens, outputTokens, reservedUnits, settledUnits].some((count, index) => {
    const raw = [item.attemptCount, item.inputTokens, item.outputTokens, item.reservedUnits, item.settledUnits][index]
    return raw != null && count === null
  })) return null
  // A truncated response must not present partial aggregates as complete totals.
  if (truncated && [attemptCount, inputTokens, outputTokens, reservedUnits, settledUnits].some((value) => value !== null)) return null

  const providerModels = (Array.isArray(item.providerModels) ? item.providerModels : [])
    .slice(0, 8)
    .flatMap((value) => {
      const providerModel = record(value)
      const provider = providerModel ? boundedText(providerModel.provider, 128) : ''
      const model = providerModel ? boundedText(providerModel.model, 128) : ''
      return provider && model ? [{ provider, model }] : []
    })
  const statuses = (value: unknown, allowed: Set<string>) => (Array.isArray(value) ? value : [])
    .slice(0, 8)
    .flatMap((status) => typeof status === 'string' && allowed.has(status) ? [status] : [])
  const currency = item.currency == null ? null : boundedText(item.currency, 16) || null
  return {
    providerModels,
    providerModelsTruncated: item.providerModelsTruncated === true,
    attemptCount,
    attemptStatuses: statuses(item.attemptStatuses, ATTEMPT_STATUSES),
    reservationStatuses: statuses(item.reservationStatuses, RESERVATION_STATUSES),
    outcomeUnknown: item.outcomeUnknown === true,
    inputTokens,
    outputTokens,
    currency,
    reservedUnits,
    settledUnits,
    truncated,
  }
}

/**
 * Maps the exact-run evidence response into a deliberately narrow operator view.
 * Answer text, error messages, claims, raw arguments, and raw results are never
 * retained by this browser model.
 */
export function mapRunObservation(payload: unknown): RunObservationView | null {
  const root = record(payload)
  if (!root) return null
  const runId = positiveInteger(root.runId)
  const stepCount = nonnegativeInteger(root.stepCount)
  const tokensUsed = nonnegativeInteger(root.tokensUsed)
  if (!runId || stepCount === null || tokensUsed === null) return null

  const seen = new Set<number>()
  const transcript = (Array.isArray(root.transcript) ? root.transcript : [])
    .slice(0, MAX_STEPS)
    .flatMap((value) => {
      const item = record(value)
      const id = item && positiveInteger(item.id)
      const stepNo = item && nonnegativeInteger(item.stepNo)
      const durationMs = item && nonnegativeInteger(item.durationMs)
      const toolName = item ? boundedText(item.toolName, 128) : ''
      if (!item || !id || stepNo === null || durationMs === null || !toolName || seen.has(id)) return []
      seen.add(id)
      const outputRowCount = nonnegativeInteger(item.outputRowCount)
      const error = item.error === true
      const hash = boundedText(item.inputHash, 64)
      return [{
        id,
        stepNo,
        toolName,
        inputHash: /^[a-fA-F0-9]{64}$/.test(hash) ? hash.toLowerCase() : null,
        // Reconstruct the only permitted summaries instead of trusting prose.
        resultSummary: error
          ? 'tool failed'
          : outputRowCount === null
            ? 'completed'
            : `${outputRowCount} row(s)`,
        outputRowCount,
        durationMs,
        error,
      }]
    })
    .sort((left, right) => left.stepNo - right.stepNo || left.id - right.id)

  return {
    runId,
    status: boundedText(root.status, 64) || 'unknown',
    stepCount,
    tokensUsed,
    transcript,
    economics: root.economics == null ? null : mapRunEconomics(root.economics),
  }
}
