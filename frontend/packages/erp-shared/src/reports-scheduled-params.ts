/**
 * Form → `CreateScheduledReportParams` for `create_scheduled_report`.
 */

import type { CreateScheduledReportParams } from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "./stb-timestamp"

function parseU64(v: unknown): bigint | null {
  if (typeof v === 'bigint' && v >= 0n) return v
  const t = String(v ?? '').trim()
  if (t === '') return null
  try {
    const b = BigInt(t)
    return b >= 0n ? b : null
  } catch {
    return null
  }
}

function parseU8(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(255, Math.max(0, Math.trunc(n)))
}

function timestampFromField(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

export function toCreateScheduledReportParams(
  formData: Record<string, unknown>,
): CreateScheduledReportParams | null {
  const name = String(formData.name ?? '').trim()
  const reportTemplateId = parseU64(formData.reportTemplateId)
  if (!name || reportTemplateId == null) return null

  const nextRun = timestampFromField(formData.nextRun)
  if (!nextRun) return null

  const recipientsRaw = String(formData.recipients ?? '')
  const recipients = recipientsRaw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (recipients.length === 0) return null

  const frequency = String(formData.frequency ?? 'Weekly')
  const ms = Number(nextRun.microsSinceUnixEpoch) / 1000
  const local = new Date(ms)
  const hour = parseU8(local.getHours(), 9)
  const minute = parseU8(local.getMinutes(), 0)

  return {
    name,
    reportTemplateId,
    model: String(formData.model ?? 'account.move'),
    frequency,
    hour,
    minute,
    attachmentFormat: String(formData.attachmentFormat ?? 'PDF'),
    nextRun,
    isActive: Boolean(formData.isActive ?? true),
    recipients,
    description: undefined,
    domain: undefined,
    dayOfWeek: undefined,
    dayOfMonth: undefined,
    subject: undefined,
    body: undefined,
    metadata: undefined,
  }
}
