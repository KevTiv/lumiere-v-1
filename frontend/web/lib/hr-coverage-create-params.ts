/** Auto-generated Create*Params mappers for hr coverage gap. */

import type {
  CreateBenefitPlanParams,
  CreateHrApplicantParams,
  CreateHrEmployeeDocumentParams,
  CreateHrEmployeeSkillParams,
  CreateHrGlobalAssignmentParams,
  CreateHrIntegrationIntentParams,
  CreateHrLaborCostSnapshotParams,
  CreateHrShiftOptJobParams,
  CreateHrSkillParams,
  CreateOnboardingTemplateItemParams,
  CreateOnboardingTemplateParams,
  CreatePayrollExportIntentParams,
  CreatePerformanceCycleParams,
  CreateStatutoryIdParams,
  CreateWorkScheduleParams,
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

export function toCreateOnboardingTemplateItemParams(
  formData: Record<string, unknown>,
): CreateOnboardingTemplateItemParams | null {
  const title = optionalTrimmedString(field(formData, "title", "title"))
  if (!title) return null

  return {
    title,
    description: optionalTrimmedString(field(formData, "description", "description")),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 0)),
    required: Boolean(field(formData, "required", "required")),
  }
}

export function toCreateBenefitPlanParams(
  formData: Record<string, unknown>,
): CreateBenefitPlanParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  const planType = optionalTrimmedString(field(formData, "planType", "plan_type"))
  if (!name || !planType) return null

  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    planType,
    active: field(formData, "active", "active") !== false,
  }
}

export function toCreateHrApplicantParams(
  formData: Record<string, unknown>,
): CreateHrApplicantParams | null {
  const jobPositionId = optionalBigIntU64(field(formData, "jobPositionId", "job_position_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (jobPositionId === undefined || !name) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    jobPositionId,
    name,
    email: optionalTrimmedString(field(formData, "email", "email")),
    stage: optionalTrimmedString(field(formData, "stage", "stage")) ?? "",
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
  }
}

export function toCreateHrEmployeeDocumentParams(
  formData: Record<string, unknown>,
): CreateHrEmployeeDocumentParams | null {
  const docType = optionalTrimmedString(field(formData, "docType", "doc_type"))
  const attachmentId = optionalTrimmedString(field(formData, "attachmentId", "attachment_id"))
  const purpose = optionalTrimmedString(field(formData, "purpose", "purpose"))
  if (!docType || !attachmentId || !purpose) return null

  return {
    docType,
    attachmentId,
    purpose,
    title: optionalTrimmedString(field(formData, "title", "title")),
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
    active: field(formData, "active", "active") !== false,
  }
}

export function toCreateHrEmployeeSkillParams(
  formData: Record<string, unknown>,
): CreateHrEmployeeSkillParams | null {
  const employeeId = optionalBigIntU64(field(formData, "employeeId", "employee_id"))
  const skillId = optionalBigIntU64(field(formData, "skillId", "skill_id"))
  if (employeeId === undefined || skillId === undefined) return null

  return {
    employeeId,
    skillId,
    level: Math.trunc(num(field(formData, "level", "level"), 0)),
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateHrGlobalAssignmentParams(
  formData: Record<string, unknown>,
): CreateHrGlobalAssignmentParams | null {
  const employeeId = optionalBigIntU64(field(formData, "employeeId", "employee_id"))
  const status = optionalTrimmedString(field(formData, "status", "status"))
  if (employeeId === undefined || !status) return null

  return {
    employeeId,
    homeCompanyId: optionalBigIntU64(field(formData, "homeCompanyId", "home_company_id")) ?? 0n,
    hostCompanyId: optionalBigIntU64(field(formData, "hostCompanyId", "host_company_id")) ?? 0n,
    dateFrom: requiredTimestampFromForm(field(formData, "dateFrom", "date_from")) ?? stbTimestampFromDate(new Date()),
    dateTo: optionalTimestampFromForm(field(formData, "dateTo", "date_to")),
    status,
    notes: optionalTrimmedString(field(formData, "notes", "notes")),
  }
}

export function toCreateHrIntegrationIntentParams(
  formData: Record<string, unknown>,
): CreateHrIntegrationIntentParams | null {
  const intentKind = optionalTrimmedString(field(formData, "intentKind", "intent_kind"))
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  if (!intentKind || !idempotencyKey || !payload) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")),
    intentKind,
    idempotencyKey,
    payslipId: optionalBigIntU64(field(formData, "payslipId", "payslip_id")),
    exportIntentId: optionalBigIntU64(field(formData, "exportIntentId", "export_intent_id")),
    payload,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateHrLaborCostSnapshotParams(
  formData: Record<string, unknown>,
): CreateHrLaborCostSnapshotParams | null {
  const currencyCode = optionalTrimmedString(field(formData, "currencyCode", "currency_code"))
  const status = optionalTrimmedString(field(formData, "status", "status"))
  if (!currencyCode || !status) return null

  return {
    employeeId: optionalBigIntU64(field(formData, "employeeId", "employee_id")),
    periodStart: requiredTimestampFromForm(field(formData, "periodStart", "period_start")) ?? stbTimestampFromDate(new Date()),
    periodEnd: requiredTimestampFromForm(field(formData, "periodEnd", "period_end")) ?? stbTimestampFromDate(new Date()),
    totalLaborCost: num(field(formData, "totalLaborCost", "total_labor_cost"), 0),
    currencyCode,
    status,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateHrShiftOptJobParams(
  formData: Record<string, unknown>,
): CreateHrShiftOptJobParams | null {
  const scope = optionalTrimmedString(field(formData, "scope", "scope"))
  const status = optionalTrimmedString(field(formData, "status", "status"))
  if (!scope || !status) return null

  return {
    scope,
    status,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
    resultSummary: optionalTrimmedString(field(formData, "resultSummary", "result_summary")),
  }
}

export function toCreateHrSkillParams(
  formData: Record<string, unknown>,
): CreateHrSkillParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    code: optionalTrimmedString(field(formData, "code", "code")),
    category: optionalTrimmedString(field(formData, "category", "category")),
    description: optionalTrimmedString(field(formData, "description", "description")),
    active: field(formData, "active", "active") !== false,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateOnboardingTemplateParams(
  formData: Record<string, unknown>,
): CreateOnboardingTemplateParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  const rawItems = field(formData, "items", "items")
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((item: unknown) =>
      toCreateOnboardingTemplateItemParams((item ?? {}) as Record<string, unknown>),
    )
    .filter((x): x is CreateOnboardingTemplateItemParams => x != null)

  return {
    items,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    active: field(formData, "active", "active") !== false,
  }
}

export function toCreatePayrollExportIntentParams(
  formData: Record<string, unknown>,
): CreatePayrollExportIntentParams | null {
  const idempotencyKey = optionalTrimmedString(field(formData, "idempotencyKey", "idempotency_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  if (!idempotencyKey || !payload) return null

  return {
    packKey: optionalTrimmedString(field(formData, "packKey", "pack_key")),
    idempotencyKey,
    payload,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreatePerformanceCycleParams(
  formData: Record<string, unknown>,
): CreatePerformanceCycleParams | null {
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (!name) return null

  return {
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    startDate: requiredTimestampFromForm(field(formData, "startDate", "start_date")) ?? stbTimestampFromDate(new Date()),
    endDate: requiredTimestampFromForm(field(formData, "endDate", "end_date")) ?? stbTimestampFromDate(new Date()),
    state: optionalTrimmedString(field(formData, "state", "state")) ?? "",
    active: field(formData, "active", "active") !== false,
  }
}

export function toCreateStatutoryIdParams(
  formData: Record<string, unknown>,
): CreateStatutoryIdParams | null {
  const employeeId = optionalBigIntU64(field(formData, "employeeId", "employee_id"))
  const idKind = optionalTrimmedString(field(formData, "idKind", "id_kind"))
  const value = optionalTrimmedString(field(formData, "value", "value"))
  if (employeeId === undefined || !idKind || !value) return null

  return {
    employeeId,
    idKind,
    value,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWorkScheduleParams(
  formData: Record<string, unknown>,
): CreateWorkScheduleParams | null {
  const employeeId = optionalBigIntU64(field(formData, "employeeId", "employee_id"))
  const name = optionalTrimmedString(field(formData, "name", "name"))
  if (employeeId === undefined || !name) return null

  return {
    employeeId,
    name,
    workHoursPerWeek: num(field(formData, "workHoursPerWeek", "work_hours_per_week"), 0),
    isActive: field(formData, "isActive", "is_active") !== false,
  }
}

