import type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreateLeaveTypeParams,
  CreatePayrollStructureParams,
  CreatePayslipParams,
  CreateSalaryRuleParams,
} from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { optionalBigIntU64 } from "@/lib/form-coercion"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function optionalString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredTimestamp(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : stbTimestampFromDate(d)
}

function optionalTimestamp(v: unknown): Timestamp | undefined {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
}

function employmentTypeFromForm(v: unknown): CreateEmployeeParams["employmentType"] {
  const tag = String(v ?? "FullTime")
  if (tag === "PartTime" || tag === "Contract" || tag === "Intern") return { tag }
  return { tag: "FullTime" }
}

function currencyIdFromLookup(v: unknown): unknown {
  if (typeof v === "object" && v !== null && "currencyId" in v) {
    return (v as { currencyId: unknown }).currencyId
  }
  return v
}

export function toCreateEmployeeParams(
  formData: Record<string, unknown>,
): Partial<CreateEmployeeParams> {
  return {
    name: String(formData.name ?? ""),
    jobId: undefined,
    departmentId: optionalBigIntU64(formData.departmentId),
    employmentType: employmentTypeFromForm(formData.employmentType),
    workEmail: optionalString(formData.workEmail),
    employeeNumber: undefined,
    jobTitle: optionalString(formData.jobTitle),
    parentId: undefined,
    coachId: undefined,
    workPhone: optionalString(formData.workPhone),
    mobilePhone: undefined,
    workLocation: optionalString(formData.workLocation),
    dateHired: optionalTimestamp(formData.dateHired),
    gender: undefined,
    birthday: undefined,
    marital: undefined,
    emergencyContact: undefined,
    emergencyPhone: undefined,
    barcode: undefined,
    pin: undefined,
    imageUrl: undefined,
    color: undefined,
    isActive: true,
    metadata: undefined,
  }
}

export function toCreateLeaveRequestParams(
  formData: Record<string, unknown>,
): Partial<CreateLeaveRequestParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const leaveTypeId = optionalBigIntU64(formData.leaveTypeId)
  const dateFrom = requiredTimestamp(formData.dateFrom)
  const dateTo = requiredTimestamp(formData.dateTo)
  if (employeeId === undefined || leaveTypeId === undefined || dateFrom === null || dateTo === null) {
    return null
  }

  return {
    employeeId,
    leaveTypeId,
    dateFrom,
    dateTo,
    numberOfDays: Number(formData.numberOfDays ?? 0),
    notes: optionalString(formData.notes),
    name: undefined,
    managerId: undefined,
  }
}

export function toCreateContractParams(
  formData: Record<string, unknown>,
  currencyId: unknown,
): Partial<CreateContractParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const parsedCurrencyId = optionalBigIntU64(currencyIdFromLookup(currencyId))
  const dateStart = requiredTimestamp(formData.dateStart)
  if (employeeId === undefined || parsedCurrencyId === undefined || dateStart === null) return null

  return {
    employeeId,
    name: String(formData.name ?? ""),
    dateStart,
    wage: Number(formData.wage ?? 0),
    currencyId: parsedCurrencyId,
    jobId: undefined,
    departmentId: undefined,
    dateEnd: optionalTimestamp(formData.dateEnd),
    notes: undefined,
  }
}

export function toCreatePayslipParams(
  formData: Record<string, unknown>,
): Partial<CreatePayslipParams> | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const structId = optionalBigIntU64(formData.structId)
  const dateFrom = requiredTimestamp(formData.dateFrom)
  const dateTo = requiredTimestamp(formData.dateTo)
  if (employeeId === undefined || structId === undefined || dateFrom === null || dateTo === null) {
    return null
  }

  return {
    employeeId,
    structId,
    dateFrom,
    dateTo,
    basicWage: Number(formData.basicWage ?? 0),
    contractId: optionalBigIntU64(formData.contractId),
    notes: undefined,
  }
}

export function toCreateJobPositionParams(
  formData: Record<string, unknown>,
): Partial<CreateJobPositionParams> {
  return {
    name: String(formData.name ?? ""),
    departmentId: optionalBigIntU64(formData.departmentId),
    expectedEmployees: Number(formData.expectedEmployees ?? 1),
    description: undefined,
    requirements: undefined,
    state: String(formData.state ?? "recruit"),
    isActive: true,
  }
}

export function toCreateDepartmentParams(
  formData: Record<string, unknown>,
): Partial<CreateDepartmentParams> {
  return {
    name: String(formData.name ?? ""),
    parentId: optionalBigIntU64(formData.parentId),
    completeName: undefined,
    managerId: optionalBigIntU64(formData.managerId),
    note: optionalString(formData.note),
    isActive: true,
    color: undefined,
  }
}

export function toCreateLeaveTypeParams(
  formData: Record<string, unknown>,
): CreateLeaveTypeParams {
  return {
    name: String(formData.name ?? "").trim(),
    allocationType: String(formData.allocationType ?? formData.allocation_type ?? "fixed"),
    maxLeaves: Number(formData.maxLeaves ?? formData.max_leaves ?? 0),
    code: optionalString(formData.code),
    color:
      formData.color != null && String(formData.color).trim() !== ""
        ? Math.trunc(Number(formData.color))
        : undefined,
    validityStart: optionalTimestamp(formData.validityStart ?? formData.validity_start),
    validityStop: optionalTimestamp(formData.validityStop ?? formData.validity_stop),
    isActive: formData.isActive !== false && formData.is_active !== false,
  }
}

export function toCreatePayrollStructureParams(
  formData: Record<string, unknown>,
): CreatePayrollStructureParams {
  return {
    name: String(formData.name ?? "").trim(),
    type: String(formData.type ?? formData.type_ ?? "regular"),
    isActive: formData.isActive !== false && formData.is_active !== false,
  }
}

export function toCreateSalaryRuleParams(
  formData: Record<string, unknown>,
): CreateSalaryRuleParams | null {
  const structureId = optionalBigIntU64(formData.structureId ?? formData.structure_id)
  if (structureId === undefined) return null
  return {
    name: String(formData.name ?? "").trim(),
    code: String(formData.code ?? "").trim(),
    structureId,
    category: String(formData.category ?? ""),
    conditionType: String(formData.conditionType ?? formData.condition_type ?? "none"),
    amountType: String(formData.amountType ?? formData.amount_type ?? "fixed"),
    amountFix: Number(formData.amountFix ?? formData.amount_fix ?? 0),
    amountPercentage: Number(formData.amountPercentage ?? formData.amount_percentage ?? 0),
    sequence: Math.max(0, Math.trunc(Number(formData.sequence ?? 10))),
    isActive: formData.isActive !== false && formData.is_active !== false,
  }
}

export function toCreateAttendancePunchParams(
  formData: Record<string, unknown>,
): {
  employeeId: bigint
  checkIn: Timestamp
  checkOut?: Timestamp
  source: string
} | null {
  const employeeId = optionalBigIntU64(formData.employeeId)
  const checkIn = requiredTimestamp(formData.checkIn)
  if (employeeId === undefined || checkIn === null) return null
  const source = optionalString(formData.source) ?? "manual"
  const checkOut = optionalTimestamp(formData.checkOut)
  return {
    employeeId,
    checkIn,
    checkOut,
    source,
  }
}
