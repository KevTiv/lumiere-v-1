/**
 * Form → `CreateAnalyticsMetricParams` for `create_analytics_metric`.
 */

import type { CreateAnalyticsMetricParams } from '@lumiere/stdb/types'

function parseU32(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(0xffffffff, Math.trunc(n))
}

function parseF64Opt(v: unknown): number | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function toCreateAnalyticsMetricParams(
  formData: Record<string, unknown>,
): CreateAnalyticsMetricParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    category: String(formData.category ?? 'Financial'),
    metricType: String(formData.metricType ?? 'KPI'),
    model: String(formData.model ?? 'account.move'),
    field: String(formData.field ?? 'amount_total'),
    aggregation: String(formData.aggregation ?? 'Sum'),
    timePeriod: String(formData.timePeriod ?? 'This Month'),
    refreshFrequencyMinutes: parseU32(formData.refreshFrequencyMinutes, 60),
    isActive: Boolean(formData.isActive ?? true),
    domain: undefined,
    targetValue: parseF64Opt(formData.targetValue),
    targetPeriod: undefined,
    metadata: undefined,
  }
}
