import type { JsonObject } from '@lumiere/api-client/json-object'

import { mapRunEconomics, type RunEconomicsView } from './run-observation'

export interface RunHistoryView {
  runs: Array<{
    runId: number
    status: string
    skillId: number
    agentId: number
    stepCount: number
    tokensUsed: number | null
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
  if (!root || !Array.isArray(root.runs) || root.runs.length > 50) return null
  if (root.nextCursor !== null && typeof root.nextCursor !== 'string') return null
  const cursor = root.nextCursor === null ? null : text(root.nextCursor, 32)
  if (cursor !== null && !/^[A-Za-z0-9_-]{11}$/.test(cursor)) return null
  const runs: RunHistoryView['runs'] = []
  const ids = new Set<number>()
  for (const value of root.runs) {
    const item = record(value)
    const runId = item && positiveInteger(item.runId)
    const skillId = item && nonnegativeInteger(item.skillId)
    const agentId = item && positiveInteger(item.agentId)
    const stepCount = item && nonnegativeInteger(item.stepCount)
    const tokensUsed = item?.tokensUsed === null ? null : item && nonnegativeInteger(item.tokensUsed)
    const status = item ? text(item.status, 64) : ''
    const startedAt = item ? text(item.startedAt, 128) : ''
    if (!item || !runId || skillId === null || !agentId || stepCount === null ||
        (item.tokensUsed !== null && tokensUsed === null) || !status || !startedAt || ids.has(runId)) return null
    ids.add(runId)
    const economics = item.economics == null ? null : mapRunEconomics(item.economics)
    runs.push({
      runId,
      status,
      skillId,
      agentId,
      stepCount,
      tokensUsed: skillId === 0 || economics?.meteredUsage || (item.economics != null && !economics) ? null : tokensUsed,
      startedAt,
      completedAt: item.completedAt == null ? null : text(item.completedAt, 128) || null,
      economics,
    })
  }
  return { runs, nextCursor: cursor }
}

export function runHistoryRequest(companyId: number, cursor: string | null, limit = 20) {
  return { companyId, cursor, limit }
}
