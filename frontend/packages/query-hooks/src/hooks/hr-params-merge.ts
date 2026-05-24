import type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreatePayslipParams,
} from "@lumiere/stdb/types"

const UNIX_EPOCH_TIMESTAMP = { microsSinceUnixEpoch: 0n }
const DEFAULT_EMPLOYMENT_TYPE: CreateEmployeeParams["employmentType"] = { tag: "FullTime" }

/** Merge partial HR create payloads with hook defaults before `stdbParamsToJson`. */
export function finalizeCreateDepartmentParams(
  partial: Partial<CreateDepartmentParams>,
): CreateDepartmentParams {
  return {
    companyId: partial.companyId,
    name: partial.name ?? "",
    parentId: partial.parentId,
    completeName: partial.completeName,
    managerId: partial.managerId,
    note: partial.note,
    isActive: partial.isActive ?? true,
    color: partial.color,
  }
}

export function finalizeCreateJobPositionParams(
  partial: Partial<CreateJobPositionParams>,
): CreateJobPositionParams {
  return {
    companyId: partial.companyId,
    name: partial.name ?? "",
    departmentId: partial.departmentId,
    expectedEmployees: partial.expectedEmployees ?? 1,
    description: partial.description,
    requirements: partial.requirements,
    state: partial.state ?? "recruit",
    isActive: partial.isActive ?? true,
  }
}

export function finalizeCreateEmployeeParams(
  partial: Partial<CreateEmployeeParams>,
): CreateEmployeeParams {
  return {
    companyId: partial.companyId,
    name: partial.name ?? "",
    jobId: partial.jobId,
    departmentId: partial.departmentId,
    employmentType: partial.employmentType ?? DEFAULT_EMPLOYMENT_TYPE,
    workEmail: partial.workEmail,
    employeeNumber: partial.employeeNumber,
    jobTitle: partial.jobTitle,
    parentId: partial.parentId,
    coachId: partial.coachId,
    workPhone: partial.workPhone,
    mobilePhone: partial.mobilePhone,
    workLocation: partial.workLocation,
    dateHired: partial.dateHired,
    gender: partial.gender,
    birthday: partial.birthday,
    marital: partial.marital,
    emergencyContact: partial.emergencyContact,
    emergencyPhone: partial.emergencyPhone,
    barcode: partial.barcode,
    pin: partial.pin,
    imageUrl: partial.imageUrl,
    color: partial.color,
    isActive: partial.isActive ?? true,
    metadata: partial.metadata,
  }
}

export function finalizeCreateLeaveRequestParams(
  partial: Partial<CreateLeaveRequestParams>,
): CreateLeaveRequestParams {
  return {
    employeeId: partial.employeeId ?? 0n,
    leaveTypeId: partial.leaveTypeId ?? 0n,
    dateFrom: partial.dateFrom ?? (UNIX_EPOCH_TIMESTAMP as CreateLeaveRequestParams["dateFrom"]),
    dateTo: partial.dateTo ?? (UNIX_EPOCH_TIMESTAMP as CreateLeaveRequestParams["dateTo"]),
    numberOfDays: partial.numberOfDays ?? 0,
    notes: partial.notes,
    name: partial.name,
    managerId: partial.managerId,
  }
}

export function finalizeCreateContractParams(
  partial: Partial<CreateContractParams>,
): CreateContractParams {
  return {
    companyId: partial.companyId,
    employeeId: partial.employeeId ?? 0n,
    name: partial.name ?? "",
    dateStart: partial.dateStart ?? (UNIX_EPOCH_TIMESTAMP as CreateContractParams["dateStart"]),
    wage: partial.wage ?? 0,
    currencyId: partial.currencyId ?? 0n,
    jobId: partial.jobId,
    departmentId: partial.departmentId,
    dateEnd: partial.dateEnd,
    notes: partial.notes,
  }
}

export function finalizeCreatePayslipParams(
  partial: Partial<CreatePayslipParams>,
): CreatePayslipParams {
  return {
    companyId: partial.companyId,
    employeeId: partial.employeeId ?? 0n,
    structId: partial.structId ?? 0n,
    dateFrom: partial.dateFrom ?? (UNIX_EPOCH_TIMESTAMP as CreatePayslipParams["dateFrom"]),
    dateTo: partial.dateTo ?? (UNIX_EPOCH_TIMESTAMP as CreatePayslipParams["dateTo"]),
    basicWage: partial.basicWage ?? 0,
    contractId: partial.contractId,
    notes: partial.notes,
  }
}
