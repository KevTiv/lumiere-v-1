/** Auto-generated Create*Params mappers for projects coverage gap. */

import type {
  CreateProjectChangeOrderParams,
  CreateProjectIntegrationIntentParams,
  CreateProjectMilestoneParams,
  CreateProjectRateCardLineParams,
  CreateProjectRateCardParams,
  CreateProjectRevenueLineParams,
  CreateProjectRevenueScheduleParams,
  CreateProjectTaskStageParams,
  CreatePublicHolidayParams,
  CreateResourceAllocationParams,
  CreateWorkingCalendarParams,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "@lumiere/erp-shared/create-params-helpers"

export function toCreateProjectTaskStageParams(
  formData: Record<string, unknown>,
): CreateProjectTaskStageParams | null {
  const projectId = optionalBigIntU64(field(formData, "projectId", "project_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (projectId === undefined || !name) return null

  return {
    projectId,
    name,
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    isClosed: Boolean(field(formData, "isClosed", "is_closed")),
  }
}

export function toCreateProjectRateCardLineParams(
  formData: Record<string, unknown>,
): CreateProjectRateCardLineParams | null {
  const rateCardId = optionalBigIntU64(field(formData, "rateCardId", "rate_card_id"))
  const scope = optionalTrimmedString(field(formData, "scope", "scope"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (rateCardId === undefined || !scope || currencyId === undefined) return null

  return {
    rateCardId,
    scope,
    employeeId: optionalBigIntU64(field(formData, "employeeId", "employee_id")),
    taskId: optionalBigIntU64(field(formData, "taskId", "task_id")),
    currencyId,
    costRate: num(field(formData, "costRate", "cost_rate"), 0),
    sellRate: num(field(formData, "sellRate", "sell_rate"), 0),
    active: field(formData, "active", "active") !== false,
    effectiveFrom: optionalTimestampFromForm(field(formData, "effectiveFrom", "effective_from")),
    effectiveTo: optionalTimestampFromForm(field(formData, "effectiveTo", "effective_to")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectRevenueLineParams(
  formData: Record<string, unknown>,
): CreateProjectRevenueLineParams | null {
  const scheduleId = optionalBigIntU64(field(formData, "scheduleId", "schedule_id"))
  if (scheduleId === undefined) return null

  return {
    scheduleId,
    recognitionDate: requiredTimestampFromForm(field(formData, "recognitionDate", "recognition_date")) ?? stbTimestampFromDate(new Date()),
    amount: num(field(formData, "amount", "amount"), 0),
    percent: num(field(formData, "percent", "percent"), 0),
    milestoneId: optionalBigIntU64(field(formData, "milestoneId", "milestone_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectChangeOrderParams(
  formData: Record<string, unknown>,
): CreateProjectChangeOrderParams | null {
  const projectId = optionalBigIntU64(field(formData, "projectId", "project_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (projectId === undefined || !name) return null

  return {
    projectId,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    scopeDelta: optionalTrimmedString(field(formData, "scopeDelta", "scope_delta")),
    budgetDelta: num(field(formData, "budgetDelta", "budget_delta"), 0),
    plannedHoursDelta: num(field(formData, "plannedHoursDelta", "planned_hours_delta"), 0),
    rateDeltaPercent: num(field(formData, "rateDeltaPercent", "rate_delta_percent"), 0),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateProjectIntegrationIntentParams | null {
  const intentType = optionalTrimmedString(field(formData, "intentType", "intent_type"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  if (!intentType || !idempotencyKey || !payload) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    projectId: optionalBigIntU64(field(formData, "projectId", "project_id")),
    intentType,
    idempotencyKey,
    payload,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectMilestoneParams(
  formData: Record<string, unknown>,
): CreateProjectMilestoneParams | null {
  const projectId = optionalBigIntU64(field(formData, "projectId", "project_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (projectId === undefined || !name) return null

  return {
    projectId,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    deadline: optionalTimestampFromForm(field(formData, "deadline", "deadline")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    isReached: Boolean(field(formData, "isReached", "is_reached")),
    billAmount: num(field(formData, "billAmount", "bill_amount"), 0),
    percentComplete: num(field(formData, "percentComplete", "percent_complete"), 0),
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectRateCardParams(
  formData: Record<string, unknown>,
): CreateProjectRateCardParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  if (!name || currencyId === undefined) return null

  return {
    name,
    currencyId,
    projectId: optionalBigIntU64(field(formData, "projectId", "project_id")),
    active: field(formData, "active", "active") !== false,
    effectiveFrom: optionalTimestampFromForm(field(formData, "effectiveFrom", "effective_from")),
    effectiveTo: optionalTimestampFromForm(field(formData, "effectiveTo", "effective_to")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateProjectRevenueScheduleParams(
  formData: Record<string, unknown>,
): CreateProjectRevenueScheduleParams | null {
  const projectId = optionalBigIntU64(field(formData, "projectId", "project_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const recognitionMethod = optionalTrimmedString(field(formData, "recognitionMethod", "recognition_method"))
  if (projectId === undefined || !name || !recognitionMethod) return null

  const currencyId = optionalBigIntU64(field(formData, "currencyId", "currency_id"))
  const journalId = optionalBigIntU64(field(formData, "journalId", "journal_id"))
  const deferredAccountId = optionalBigIntU64(field(formData, "deferredAccountId", "deferred_account_id"))
  const incomeAccountId = optionalBigIntU64(field(formData, "incomeAccountId", "income_account_id"))
  if (currencyId === undefined || journalId === undefined || deferredAccountId === undefined || incomeAccountId === undefined) return null

  return {
    projectId,
    milestoneId: optionalBigIntU64(field(formData, "milestoneId", "milestone_id")),
    name,
    recognitionMethod,
    totalAmount: num(field(formData, "totalAmount", "total_amount"), 0),
    currencyId,
    journalId,
    deferredAccountId,
    incomeAccountId,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePublicHolidayParams(
  formData: Record<string, unknown>,
): CreatePublicHolidayParams | null {
  const packKey = optionalTrimmedString(field(formData, "packKey", "pack_key"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!packKey || !name) return null

  return {
    calendarId: optionalBigIntU64(field(formData, "calendarId", "calendar_id")),
    packKey,
    name,
    holidayDate: requiredTimestampFromForm(field(formData, "holidayDate", "holiday_date")) ?? stbTimestampFromDate(new Date()),
    isRecurring: Boolean(field(formData, "isRecurring", "is_recurring")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateResourceAllocationParams(
  formData: Record<string, unknown>,
): CreateResourceAllocationParams | null {
  const projectId = optionalBigIntU64(field(formData, "projectId", "project_id"))
  if (projectId === undefined) return null

  return {
    employeeId: optionalBigIntU64(field(formData, "employeeId", "employee_id")),
    resourceId: optionalBigIntU64(field(formData, "resourceId", "resource_id")),
    projectId,
    taskId: optionalBigIntU64(field(formData, "taskId", "task_id")),
    dateFrom: requiredTimestampFromForm(field(formData, "dateFrom", "date_from")) ?? stbTimestampFromDate(new Date()),
    dateTo: requiredTimestampFromForm(field(formData, "dateTo", "date_to")) ?? stbTimestampFromDate(new Date()),
    allocatedHours: num(field(formData, "allocatedHours", "allocated_hours"), 0),
    allocationPercent: num(field(formData, "allocationPercent", "allocation_percent"), 0),
    name: optionalTrimmedString(field(formData, "name", "name")),
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
    enforceCapacity: Boolean(field(formData, "enforceCapacity", "enforce_capacity")),
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWorkingCalendarParams(
  formData: Record<string, unknown>,
): CreateWorkingCalendarParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const packKey = optionalTrimmedString(field(formData, "packKey", "pack_key"))
  if (!name || !packKey) return null

  return {
    name,
    packKey,
    hoursPerDay: num(field(formData, "hoursPerDay", "hours_per_day"), 0),
    workMonday: Boolean(field(formData, "workMonday", "work_monday")),
    workTuesday: Boolean(field(formData, "workTuesday", "work_tuesday")),
    workWednesday: Boolean(field(formData, "workWednesday", "work_wednesday")),
    workThursday: Boolean(field(formData, "workThursday", "work_thursday")),
    workFriday: Boolean(field(formData, "workFriday", "work_friday")),
    workSaturday: Boolean(field(formData, "workSaturday", "work_saturday")),
    workSunday: Boolean(field(formData, "workSunday", "work_sunday")),
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
