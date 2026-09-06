"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import type {
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  HrDepartment,
  HrEmployee,
  HrJobPosition,
  UpdateDepartmentParams,
  UpdateEmployeeParams,
  UpdateJobPositionParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import {
  finalizeCreateDepartmentParams,
  finalizeCreateEmployeeParams,
  finalizeCreateJobPositionParams,
} from "../hr-params-merge"
import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

type Timestamp = ReturnType<typeof stbTimestampFromDate>


export function useEmployees(
  organizationId: bigint,
  initialData?: HrEmployee[],
) {
  return useQuery<HrEmployee[]>({
    queryKey: ['hr-employees', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/employees', 'Failed to fetch employees'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDepartments(
  organizationId: bigint,
  initialData?: HrDepartment[],
) {
  return useQuery<HrDepartment[]>({
    queryKey: ['hr-departments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/departments', 'Failed to fetch departments'),
    staleTime: 30_000,
    initialData,
  })
}


export function useJobPositions(
  organizationId: bigint,
  initialData?: HrJobPosition[],
) {
  return useQuery<HrJobPosition[]>({
    queryKey: ['job-positions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/job-positions', 'Failed to fetch job positions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useApplicants(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['applicants', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/applicants', 'Failed to fetch applicants'),
    staleTime: 15_000,
    initialData,
  })
}

export function useCreateHrApplicant(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      companyId?: bigint
      jobPositionId: bigint
      name: string
      email?: string
      stage?: string
      notes?: string
    }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_hr_applicant", { params: stdbParamsToJson({
          companyId: params.companyId ?? companyId,
          jobPositionId: params.jobPositionId,
          name: params.name,
          email: params.email,
          stage: params.stage ?? 'applied',
          notes: params.notes,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create applicant')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['applicants', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateHrApplicant(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { applicantId: bigint; stage?: string; email?: string; notes?: string }
  >({
    mutationFn: async (params) => {
      if (companyId == null) throw new Error('companyId required')
      const { urlPath, init } = stdbBffCommandPost("update_hr_applicant", { companyId: companyId, applicantId: params.applicantId, params: stdbParamsToJson({
          stage: params.stage,
          email: params.email,
          notes: params.notes,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update applicant')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['applicants', rqBigIntKey(organizationId)] }),
  })
}


export function useAttendance(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-attendance', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/attendance', 'Failed to fetch attendance'),
    staleTime: 30_000,
    initialData,
  })
}

export function useCompensationEvents(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-compensation-events', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/compensation-events', 'Failed to fetch compensation events'),
    staleTime: 30_000,
    initialData,
  })
}

export function useWorkSchedules(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-work-schedules', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/work-schedules', 'Failed to fetch work schedules'),
    staleTime: 30_000,
    initialData,
  })
}

export function useLaborCostSnapshots(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-labor-cost-snapshots', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/labor-cost-snapshots', 'Failed to fetch labor cost snapshots'),
    staleTime: 30_000,
    initialData,
  })
}

export function useShiftOptJobs(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-shift-opt-jobs', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/shift-opt-jobs', 'Failed to fetch shift optimization jobs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useGlobalAssignments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-global-assignments', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/global-assignments', 'Failed to fetch global assignments'),
    staleTime: 30_000,
    initialData,
  })
}

export function useHrCapacityForecast(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-capacity-forecast', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/hr-capacity-forecast', 'Failed to fetch HR capacity forecast'),
    staleTime: 30_000,
    initialData,
  })
}

export function useRefreshHrCapacityForecast(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { periodStart: Timestamp; periodEnd: Timestamp; employeeId?: bigint }
  >({
    mutationFn: async ({ periodStart, periodEnd, employeeId }) => {
      if (companyId == null) throw new Error('Company scope required')
      const { urlPath, init } = stdbBffCommandPost("refresh_hr_capacity_forecast", { companyId: companyId, params: stdbParamsToJson({
          employeeId: employeeId ?? null,
          periodStart,
          periodEnd,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refresh HR capacity forecast')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-capacity-forecast', rqBigIntKey(organizationId)] }),
  })
}


export function useEmployeeDocuments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-employee-documents', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/employee-documents', 'Failed to fetch employee documents'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateDepartmentParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateDepartmentParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_department", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateJobPositionParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateJobPositionParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_job_position", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateEmployeeParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateEmployeeParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_employee", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}


export type CreateAttendancePunchParams = {
  employeeId: bigint
  checkIn: Timestamp
  checkOut?: Timestamp
  source: string
}

export type CreateWorkScheduleParams = {
  employeeId: bigint
  name: string
  workHoursPerWeek: number
  isActive: boolean
}

export function useCreateAttendancePunch(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateAttendancePunchParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_attendance_punch", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record attendance punch')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-attendance', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateWorkSchedule(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateWorkScheduleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_work_schedule", { companyId: companyId, params: stdbParamsToJson(params) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create work schedule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-work-schedules', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Update ───────────────────────────────────────────────────────

export function useUpdateDepartment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { departmentId: number; params: Partial<UpdateDepartmentParams> }>({
    mutationFn: async ({ departmentId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = stdbBffCommandPost("update_department", { departmentId: departmentId, params: stdbParamsToJson(patch) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update department')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateJobPosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { jobId: number; params: Partial<UpdateJobPositionParams> }>({
    mutationFn: async ({ jobId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = stdbBffCommandPost("update_job_position", { jobId: jobId, params: stdbParamsToJson(patch) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update job position')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; params: Partial<UpdateEmployeeParams> }>({
    mutationFn: async ({ employeeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_employee", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

export function useArchiveEmployee(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      employeeId: number
      terminationDate?: Date
      overrideIncompleteChecklist?: boolean
      overrideReason?: string
    }
  >({
    mutationFn: async ({
      employeeId,
      terminationDate,
      overrideIncompleteChecklist,
      overrideReason,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("archive_employee", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({
          terminationDate,
          overrideIncompleteChecklist: overrideIncompleteChecklist ?? false,
          overrideReason: overrideReason ?? null,
        }) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to archive employee')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}


export function useCreateHrEmployeeDocument(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      employeeId: number
      docType: string
      attachmentId: string
      purpose: string
      title?: string
      notes?: string
      active?: boolean
    }
  >({
    mutationFn: async ({ employeeId, docType, attachmentId, purpose, title, notes, active }) => {
      const { urlPath, init } = stdbBffCommandPost("create_hr_employee_document", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({
          docType,
          attachmentId,
          purpose,
          title: title ?? null,
          notes: notes ?? null,
          active: active ?? true,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employee-documents', rqBigIntKey(organizationId)] })
    },
  })
}

export function useDeleteHrEmployeeDocument(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; documentId: number; reason?: string }>({
    mutationFn: async ({ employeeId, documentId, reason }) => {
      const { urlPath, init } = stdbBffCommandPost("delete_hr_employee_document", { companyId: companyId ?? null, employeeId: employeeId, documentId: documentId, params: stdbParamsToJson({ reason: reason ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employee-documents', rqBigIntKey(organizationId)] })
    },
  })
}

// ── Mutations: Leave Types & Workflow ───────────────────────────────────────

