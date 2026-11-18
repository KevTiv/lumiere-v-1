import type { JsonObject } from '@lumiere/api-client/json-object'

/** Seven-day chat answer withhold counts, as the screen may trust them: bounded and closed-vocabulary. */

export const WITHHOLD_REASONS = [
  'malformed_submission',
  'no_claims',
  'coverage_gap',
  'unauthorized_citation',
  'unsupported_claim',
  'checker_unavailable',
  'access_changed',
  'provenance_not_recorded',
  'evidence_policy',
] as const

export type WithholdReasonKey = (typeof WITHHOLD_REASONS)[number]

export interface RagModelTotalView {
  provider: string | null
  model: string | null
  turns: number
  withheld: number
  repaired: number
  withholdRate: number
}

export interface RagReasonCellView {
  provider: string | null
  model: string | null
  reason: WithholdReasonKey
  withheld: number
  rate: number
}

export interface RagOutcomesView {
  windowDays: number
  turns: number
  withheld: number
  withholdRate: number
  models: RagModelTotalView[]
  byReasonAndModel: RagReasonCellView[]
  truncated: boolean
}

const MAX_ROWS = 200

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function fraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function label(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 120) : null
}

export function mapRagOutcomes(payload: unknown): RagOutcomesView | null {
  const root = record(payload)
  if (!root || !Array.isArray(root.models) || !Array.isArray(root.byReasonAndModel)) return null
  if (root.models.length > MAX_ROWS || root.byReasonAndModel.length > MAX_ROWS) return null
  const windowDays = count(root.windowDays)
  const turns = count(root.turns)
  const withheld = count(root.withheld)
  const withholdRate = fraction(root.withholdRate)
  if (windowDays === null || turns === null || withheld === null || withholdRate === null) return null

  const models: RagModelTotalView[] = []
  for (const raw of root.models) {
    const row = record(raw)
    const rowTurns = row ? count(row.turns) : null
    const rowWithheld = row ? count(row.withheld) : null
    const repaired = row ? count(row.repaired) : null
    const rate = row ? fraction(row.withholdRate) : null
    if (!row || rowTurns === null || rowWithheld === null || repaired === null || rate === null) return null
    models.push({ provider: label(row.provider), model: label(row.model), turns: rowTurns, withheld: rowWithheld, repaired, withholdRate: rate })
  }

  const byReasonAndModel: RagReasonCellView[] = []
  for (const raw of root.byReasonAndModel) {
    const row = record(raw)
    const reason = row && WITHHOLD_REASONS.find((known) => known === row.reason)
    const rowWithheld = row ? count(row.withheld) : null
    const rate = row ? fraction(row.rate) : null
    if (!row || !reason || rowWithheld === null || rate === null) return null
    byReasonAndModel.push({ provider: label(row.provider), model: label(row.model), reason, withheld: rowWithheld, rate })
  }

  return { windowDays, turns, withheld, withholdRate, models, byReasonAndModel, truncated: root.truncated === true }
}

export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}
