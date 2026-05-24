import type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreatePayslipParams,
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
