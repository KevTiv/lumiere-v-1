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
  }
}
