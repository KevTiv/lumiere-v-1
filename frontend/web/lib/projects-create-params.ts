/**
 * Maps Projects module form payloads to SpacetimeDB reducer param types.
 */

import type { CreateProjectParams, CreateTaskParams } from '@lumiere/stdb/types'
import type { Timestamp } from "spacetimedb"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

import { stdbParamsToJson } from '@/lib/stdb-params-json'

const TASK_STATE_IN_PROGRESS: CreateTaskParams['state'] = { tag: 'InProgress' }

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function parseF64(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function optionalTimestampFromFormDate(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

function parseU64FromForm(v: unknown): bigint | null {
  if (v === '' || v == null) return null
  if (typeof v === 'bigint') return v >= 0n ? v : null
  const n = Number(v)
  if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) return BigInt(n)
  try {
    const b = BigInt(String(v).trim())
    return b >= 0n ? b : null
  } catch {
    return null
  }
}

function optionalPartnerId(raw: unknown): bigint | undefined {
  if (raw === '' || raw == null) return undefined
  const id = parseU64FromForm(raw)
  return id ?? undefined
}

function resolveCurrencyIdFromPricelist(
  pricelistIdRaw: unknown,
  pricelists: ReadonlyArray<Record<string, unknown>>,
): bigint | null {
  if (pricelistIdRaw === '' || pricelistIdRaw == null) return null
  const pl = pricelists.find((p) => String(p.id) === String(pricelistIdRaw))
  if (pl == null) return null
  const c = pl.currencyId
  if (c === undefined || c === null) return null
  try {
    return BigInt(String(c))
  } catch {
    return null
  }
}

function parseTaskStageId(projectIdRaw: unknown, stageRaw: unknown): bigint | undefined {
  if (stageRaw === '' || stageRaw == null) return undefined
  const projStr = String(projectIdRaw)
  const composite = String(stageRaw)
  const parts = composite.split(':')
  if (parts.length === 2 && String(parts[0]) === projStr) {
    try {
      return BigInt(parts[1])
    } catch {
      return undefined
    }
  }
  return undefined
}

export function toCreateProjectParams(
  formData: Record<string, unknown>,
  pricelists: ReadonlyArray<Record<string, unknown>>,
  companyId?: bigint,
): CreateProjectParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const currencyId = resolveCurrencyIdFromPricelist(formData.pricelistId, pricelists)
  if (currencyId === null) return null

  const dateStart = optionalTimestampFromFormDate(formData.dateStart)
  const dateEnd = optionalTimestampFromFormDate(formData.dateEnd)

  return {
    companyId: companyId !== undefined ? companyId : undefined,
    name,
    description: optionalTrimmedString(formData.description),
    active: true,
    sequence: 10,
    currencyId,
    partnerId: optionalPartnerId(formData.partnerId),
    partnerEmail: undefined,
    partnerPhone: undefined,
    partnerCompanyId: undefined,
    dateStart,
    date: dateStart,
    dateEnd,
    allowSubtasks: true,
    allowRecurringTasks: true,
    allowTaskDependencies: true,
    allowTimesheets: true,
    allowTimesheetTimer: true,
    allowMaterial: false,
    allowWorksheets: false,
    allowForecast: true,
    billType: 'non_billable',
    pricingType: 'task_rate',
    ratingStatus: 'on_track',
    ratingStatusPeriod: 'monthly',
    privacyVisibility: 'followers',
    accessInstructionMessage: undefined,
    taskCount: 0,
    taskCountOpen: 0,
    taskCountClosed: 0,
    taskCountInProgress: 0,
    taskCountBlocked: 0,
    saleOrderId: undefined,
    saleLineId: undefined,
    lastUpdateStatus: 'InProgress',
    lastUpdateColor: undefined,
    isFavorite: false,
    color: undefined,
    stageId: undefined,
    analyticAccountId: undefined,
    activityIds: [],
    activityState: undefined,
    activityDateDeadline: undefined,
    activityTypeId: undefined,
    activityUserId: undefined,
    activitySummary: undefined,
    messageFollowerIds: [],
    messageIds: [],
    metadata: JSON.stringify({
      allocatedHours: formData.allocatedHours ?? null,
    }),
  }
}

export function toCreateTaskParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateTaskParams | null {
  const projectId = parseU64FromForm(formData.projectId)
  if (projectId === null) return null

  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const stageId = parseTaskStageId(formData.projectId, formData.stageId)
  const planned = parseF64(formData.plannedHours, 0)

  const dateDeadline = optionalTimestampFromFormDate(formData.dateDeadline)

  return {
    companyId: companyId !== undefined ? companyId : undefined,
    projectId,
    name,
    description: optionalTrimmedString(formData.description),
    priority: String(formData.priority ?? '0'),
    sequence: 10,
    stageId,
    state: TASK_STATE_IN_PROGRESS,
    kanbanState: 'normal',
    dateDeadline,
    dateStart: undefined,
    dateEnd: undefined,
    color: undefined,
    userIds: [],
    milestoneId: undefined,
    plannedHours: planned,
    totalHoursSpent: 0,
    effectiveHours: 0,
    progress: 0,
    remainingHours: planned,
    saleOrderId: undefined,
    saleLineId: undefined,
    partnerId: undefined,
    partnerEmail: undefined,
    parentId: undefined,
    childIds: [],
    subtaskCount: 0,
    closedSubtaskCount: 0,
    isClosed: false,
    isBlocked: false,
    allowTaskDependencies: true,
    dependOnIds: [],
    dependentIds: [],
    isPrivate: false,
    permittedUserIds: [],
    activityIds: [],
    activityState: undefined,
    activityDateDeadline: undefined,
    activityTypeId: undefined,
    activityUserId: undefined,
    activitySummary: undefined,
    messageFollowerIds: [],
    messageIds: [],
    metadata: undefined,
  }
}

export function projectsParamsToJson(
  params: CreateProjectParams | CreateTaskParams | Record<string, unknown>,
): Record<string, unknown> {
  return stdbParamsToJson(params as Record<string, unknown>)
}

// ── Update params helpers ────────────────────────────────────────────────────

export function toUpdateProjectParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const dateStart = optionalTimestampFromFormDate(formData.dateStart)
  const dateEnd = optionalTimestampFromFormDate(formData.dateEnd)

  return {
    name,
    description: optionalTrimmedString(formData.description),
    dateStart,
    dateEnd,
    partnerId: optionalPartnerId(formData.partnerId) ?? null,
    active: Boolean(formData.active),
    metadata: JSON.stringify({
      allocatedHours: formData.allocatedHours ?? null,
      pricelistId: formData.pricelistId ?? null,
    }),
  }
}

export function toUpdateTaskParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  const stageId = parseTaskStageId(formData.projectId, formData.stageId)
  const dateDeadline = optionalTimestampFromFormDate(formData.dateDeadline)

  return {
    name,
    description: optionalTrimmedString(formData.description),
    projectId: parseU64FromForm(formData.projectId) ?? undefined,
    stageId,
    priority: String(formData.priority ?? '0'),
    plannedHours: parseF64(formData.plannedHours, 0),
    dateDeadline,
    kanbanState: String(formData.kanbanState ?? 'normal'),
  }
}

// ── Timesheet params helpers ─────────────────────────────────────────────────

export function toLogTimesheetParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): Record<string, unknown> | null {
  const projectId = parseU64FromForm(formData.projectId)
  if (projectId === null) return null

  const taskId = parseU64FromForm(formData.taskId)
  const date = optionalTimestampFromFormDate(formData.date)
  if (!date) return null

  const hours = parseF64(formData.unitAmount, 0)
  if (hours <= 0) return null

  return {
    companyId: companyId !== undefined ? companyId : undefined,
    projectId,
    taskId: taskId ?? undefined,
    date,
    name: optionalTrimmedString(formData.name) ?? '',
    unitAmount: hours,
    billable: Boolean(formData.billable ?? true),
    validated: false,
    billed: false,
    encoding: 'utf-8',
    manuallyModified: true,
  }
}
