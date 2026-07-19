import type {
  UpdateContractParams,
  UpdateDepartmentParams,
  UpdateEmployeeParams,
  UpdateJobPositionParams,
  UpdateLeaveTypeParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { optionalBigIntU64 } from "@/lib/form-coercion"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import { timestampToDateInputValue } from "@/lib/crm-update-params"

function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function optionalTimestamp(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
}

function employmentTypeFromForm(v: unknown): UpdateEmployeeParams["employmentType"] {
  const tag = String(v ?? "FullTime")
  if (tag === "PartTime" || tag === "Contract" || tag === "Intern") return { tag }
  return { tag: "FullTime" }
}

export function enumTag(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object" && v !== null && "tag" in v) return String((v as { tag: unknown }).tag)
  return String(v)
}

export function rowIdString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (v != null && String(v).trim() !== "") return String(v)
  }
  return ""
}

export function employeeRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? ""),
    jobTitle: String(row.jobTitle ?? row.job_title ?? ""),
    departmentId: rowIdString(row, "departmentId", "department_id"),
    employmentType: enumTag(row.employmentType ?? row.employment_type),
    workEmail: String(row.workEmail ?? row.work_email ?? ""),
    workPhone: String(row.workPhone ?? row.work_phone ?? ""),
    workLocation: String(row.workLocation ?? row.work_location ?? ""),
  }
}

export function departmentRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? ""),
    parentId: rowIdString(row, "parentId", "parent_id"),
    managerId: rowIdString(row, "managerId", "manager_id"),
    note: String(row.note ?? ""),
    isActive: row.isActive !== false && row.is_active !== false,
  }
}

export function jobPositionRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? ""),
    departmentId: rowIdString(row, "departmentId", "department_id"),
    expectedEmployees: Number(row.expectedEmployees ?? row.expected_employees ?? 1),
    state: String(row.state ?? "recruit"),
    isActive: row.isActive !== false && row.is_active !== false,
  }
}

export function contractRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? ""),
    wage: Number(row.wage ?? 0),
    dateEnd: timestampToDateInputValue(row.dateEnd ?? row.date_end),
    notes: String(row.notes ?? ""),
  }
}

export function leaveTypeRowToFormDefaults(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? ""),
    maxLeaves: Number(row.maxLeaves ?? row.max_leaves ?? 0),
    isActive: row.isActive !== false && row.is_active !== false,
  }
}

export function toUpdateEmployeeParams(
  formData: Record<string, unknown>,
): Partial<UpdateEmployeeParams> {
  const params: Partial<UpdateEmployeeParams> = {}
  const name = optionalString(formData.name)
  if (name !== undefined) params.name = name
  const jobTitle = optionalString(formData.jobTitle)
  if (jobTitle !== undefined) params.jobTitle = jobTitle
  const departmentId = optionalBigIntU64(formData.departmentId)
  if (departmentId !== undefined) params.departmentId = departmentId
  const workEmail = optionalString(formData.workEmail)
  if (workEmail !== undefined) params.workEmail = workEmail
  const workPhone = optionalString(formData.workPhone)
  if (workPhone !== undefined) params.workPhone = workPhone
  const workLocation = optionalString(formData.workLocation)
  if (workLocation !== undefined) params.workLocation = workLocation

  if (formData.employmentType == null || String(formData.employmentType) === "") {
    return params
  }

  return {
    ...params,
    employmentType: employmentTypeFromForm(formData.employmentType),
  }
}

export function toUpdateDepartmentParams(
  formData: Record<string, unknown>,
): Partial<UpdateDepartmentParams> {
  const params: Partial<UpdateDepartmentParams> = {}
  const name = optionalString(formData.name)
  if (name !== undefined) params.name = name
  const parentId = optionalBigIntU64(formData.parentId)
  if (parentId !== undefined) params.parentId = parentId
  const managerId = optionalBigIntU64(formData.managerId)
  if (managerId !== undefined) params.managerId = managerId
  const note = optionalString(formData.note)
  if (note !== undefined) params.note = note
  if (typeof formData.isActive === "boolean") params.isActive = formData.isActive
  return params
}

export function toUpdateJobPositionParams(
  formData: Record<string, unknown>,
): Partial<UpdateJobPositionParams> {
  const params: Partial<UpdateJobPositionParams> = {}
  const name = optionalString(formData.name)
  if (name !== undefined) params.name = name
  const departmentId = optionalBigIntU64(formData.departmentId)
  if (departmentId !== undefined) params.departmentId = departmentId
  if (formData.expectedEmployees != null && String(formData.expectedEmployees) !== "") {
    params.expectedEmployees = Number(formData.expectedEmployees)
  }
  const state = optionalString(formData.state)
  if (state !== undefined) params.state = state
  if (typeof formData.isActive === "boolean") params.isActive = formData.isActive
  return params
}

export function toUpdateContractParams(
  formData: Record<string, unknown>,
): Partial<UpdateContractParams> & {
  wageChangeReason?: string
  wageEffectiveFrom?: Timestamp
} {
  const params: Partial<UpdateContractParams> & {
    wageChangeReason?: string
    wageEffectiveFrom?: Timestamp
  } = {}
  const name = optionalString(formData.name)
  if (name !== undefined) params.name = name
  if (formData.wage != null && String(formData.wage) !== "") params.wage = Number(formData.wage)
  const wageEffectiveFrom = optionalTimestamp(formData.wageEffectiveFrom)
  if (wageEffectiveFrom !== undefined) params.wageEffectiveFrom = wageEffectiveFrom
  const wageChangeReason = optionalString(formData.wageChangeReason)
  if (wageChangeReason !== undefined) params.wageChangeReason = wageChangeReason
  const dateEnd = optionalTimestamp(formData.dateEnd)
  if (dateEnd !== undefined) params.dateEnd = dateEnd
  const notes = optionalString(formData.notes)
  if (notes !== undefined) params.notes = notes
  return params
}

export function toUpdateLeaveTypeParams(
  formData: Record<string, unknown>,
): Partial<UpdateLeaveTypeParams> {
  const params: Partial<UpdateLeaveTypeParams> = {}
  const name = optionalString(formData.name)
  if (name !== undefined) params.name = name
  if (formData.maxLeaves != null && String(formData.maxLeaves) !== "") {
    params.maxLeaves = Number(formData.maxLeaves)
  }
  if (typeof formData.isActive === "boolean") params.isActive = formData.isActive
  return params
}
