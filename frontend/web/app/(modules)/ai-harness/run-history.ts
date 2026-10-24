import type { JsonObject } from '@lumiere/api-client/json-object'

import { mapRunEconomics, type RunEconomicsView } from './run-observation'

export interface RunHistoryView {
  runs: Array<{
    runId: number
    status: string
    skillId: number
    agentId: number
    stepCount: number
    tokensUsed: number
    startedAt: string
    completedAt: string | null
    economics: RunEconomicsView | null
  }>
  nextCursor: string | null
}

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

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function mapRunHistory(payload: unknown): RunHistoryView | null {
  const root = record(payload)
  if (!root || !Array.isArray(root.runs)) return null
  const cursor = root.nextCursor == null ? null : text(root.nextCursor, 32)
  if (cursor !== null && !/^[A-Za-z0-9_-]{11}$/.test(cursor)) return null
  const runs = root.runs.slice(0, 50).flatMap((value) => {
    const item = record(value)
    const runId = item && positiveInteger(item.runId)
    const skillId = item && positiveInteger(item.skillId)
    const agentId = item && positiveInteger(item.agentId)
    const stepCount = item && nonnegativeInteger(item.stepCount)
    const tokensUsed = item && nonnegativeInteger(item.tokensUsed)
    const status = item ? text(item.status, 64) : ''
    const startedAt = item ? text(item.startedAt, 128) : ''
    if (!item || !runId || !skillId || !agentId || stepCount === null || tokensUsed === null || !status || !startedAt) return []
    return [{
      runId,
      status,
      skillId,
      agentId,
      stepCount,
      tokensUsed,
      startedAt,
      completedAt: item.completedAt == null ? null : text(item.completedAt, 128) || null,
      economics: item.economics == null ? null : mapRunEconomics(item.economics),
    }]
  })
  return { runs, nextCursor: cursor }
}

export function runHistoryRequest(companyId: number, cursor: string | null, limit = 20) {
  return { companyId, cursor, limit }
}
