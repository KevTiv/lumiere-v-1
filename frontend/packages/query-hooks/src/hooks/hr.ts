"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
/**
 * HR hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the HR module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
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
  UpdateContractParams,
  UpdateDepartmentParams,
  UpdateEmployeeParams,
  UpdateJobPositionParams,
  UpdateLeaveTypeParams,
} from "@lumiere/stdb/types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

type Timestamp = ReturnType<typeof stbTimestampFromDate>
import {
  finalizeCreateContractParams,
  finalizeCreateDepartmentParams,
  finalizeCreateEmployeeParams,
  finalizeCreateJobPositionParams,
  finalizeCreateLeaveRequestParams,
  finalizeCreatePayslipParams,
  finalizeUpdateLeaveTypeParams,
} from "./hr-params-merge"

type ScalarId = bigint | number | string

function toScalarU64(v: ScalarId): bigint {
  return typeof v === "bigint" ? v : BigInt(String(v))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useEmployees(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-employees', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/employees', 'Failed to fetch employees'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDepartments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-departments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/departments', 'Failed to fetch departments'),
    staleTime: 30_000,
    initialData,
  })
}

export function useLeaveRequests(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-requests', 'Failed to fetch leave requests'),
    staleTime: 30_000,
    initialData,
  })
}

/** Bounded queue: leave requests awaiting approval (Confirm | ValidatedOne). */
export function useLeavesToApprove(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leaves-to-approve', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/leaves-to-approve', 'Failed to fetch leaves to approve'),
    staleTime: 15_000,
    initialData,
  })
}

export function useContracts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-contracts', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/contracts', 'Failed to fetch contracts'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePayslips(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payslips', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payslips', 'Failed to fetch payslips'),
    staleTime: 30_000,
    initialData,
  })
}

/** Bounded queue: payslips approved for export (Verify state). */
export function usePayslipsToExport(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payslips-to-export', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/payslips-to-export', 'Failed to fetch payslips to export'),
    staleTime: 15_000,
    initialData,
  })
}

export function useJobPositions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
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

export function useLeaveTypes(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-leave-types', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/leave-types', 'Failed to fetch leave types'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePayrollStructures(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/payroll-structures', 'Failed to fetch payroll structures'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSalaryRules(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/salary-rules', 'Failed to fetch salary rules'),
    staleTime: 30_000,
    initialData,
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

export function useOnboardingTemplates(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-templates', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-templates', 'Failed to fetch onboarding templates'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOnboardingTemplateItems(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-template-items', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-template-items', 'Failed to fetch onboarding template items'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOnboardingProgress(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-progress', 'Failed to fetch onboarding progress'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePerformanceCycles(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-cycles', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-cycles', 'Failed to fetch performance cycles'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePerformanceGoals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-goals', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-goals', 'Failed to fetch performance goals'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePerformanceReviews(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-reviews', 'Failed to fetch performance reviews'),
    staleTime: 30_000,
    initialData,
  })
}

export function useBenefitPlans(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-benefit-plans', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/benefit-plans', 'Failed to fetch benefit plans'),
    staleTime: 30_000,
    initialData,
  })
}

export function useBenefitEnrollments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/benefit-enrollments', 'Failed to fetch benefit enrollments'),
    staleTime: 30_000,
    initialData,
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

export function useCreateLeaveRequest(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateLeaveRequestParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateLeaveRequestParams(params)
      const { urlPath, init } = stdbBffCommandPost("create_leave_request", { companyId: companyId, params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave request')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreateContractParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreateContractParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_contract", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Partial<CreatePayslipParams>>({
    mutationFn: async (params) => {
      const finalized = finalizeCreatePayslipParams({
        ...params,
        companyId: params.companyId ?? companyId,
      })
      const { urlPath, init } = stdbBffCommandPost("create_payslip", { params: stdbParamsToJson(finalized) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── Attendance & schedules ───────────────────────────────────────────────────

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

export function useStartOffboarding(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (employeeId) => {
      const { urlPath, init } = stdbBffCommandPost("start_offboarding", { companyId: companyId ?? null, employeeId: employeeId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start offboarding')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompleteOffboardingItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; item: string; notes?: string }>({
    mutationFn: async ({ employeeId, item, notes }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_offboarding_item", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ item, notes: notes ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to complete offboarding item')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateOnboardingTemplate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      name: string
      description?: string
      active?: boolean
      items: Array<{ title: string; description?: string; sequence: number; required: boolean }>
    }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_onboarding_template", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          active: params.active ?? true,
          items: params.items,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-templates', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-onboarding-template-items', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAssignOnboardingTemplate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; templateId: number }>({
    mutationFn: async ({ employeeId, templateId }) => {
      const { urlPath, init } = stdbBffCommandPost("assign_onboarding_template", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ templateId }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompleteOnboardingItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; templateItemId: number; notes?: string }>({
    mutationFn: async ({ employeeId, templateItemId, notes }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_onboarding_item", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ templateItemId, notes: notes ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
    },
  })
}

export function useMarkOnboardingDone(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (employeeId) => {
      const { urlPath, init } = stdbBffCommandPost("mark_onboarding_done", { companyId: companyId ?? null, employeeId: employeeId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreatePerformanceCycle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      name: string
      description?: string
      startDate: Date
      endDate: Date
      state?: string
      active?: boolean
    }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_performance_cycle", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          startDate: stbTimestampFromDate(params.startDate),
          endDate: stbTimestampFromDate(params.endDate),
          state: params.state ?? "draft",
          active: params.active ?? true,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-cycles', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAddPerformanceGoal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      cycleId: number
      employeeId: number
      title: string
      description?: string
      targetValue?: number
      weight?: number
      state?: string
      reviewerEmployeeId?: number
    }
  >({
    mutationFn: async ({ cycleId, ...params }) => {
      const { urlPath, init } = stdbBffCommandPost("add_performance_goal", { companyId: companyId ?? null, cycleId: cycleId, params: stdbParamsToJson({
          employeeId: params.employeeId,
          title: params.title,
          description: params.description ?? null,
          targetValue: params.targetValue ?? null,
          weight: params.weight ?? 1,
          state: params.state ?? "draft",
          reviewerEmployeeId: params.reviewerEmployeeId ?? null,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-goals', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}

export function useSubmitPerformanceReview(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reviewId: number; selfRating: number; summary?: string }
  >({
    mutationFn: async ({ reviewId, selfRating, summary }) => {
      const { urlPath, init } = stdbBffCommandPost("submit_performance_review", { companyId: companyId ?? null, reviewId: reviewId, params: stdbParamsToJson({ selfRating, summary: summary ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompletePerformanceReview(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reviewId: number; managerRating: number; summary?: string }
  >({
    mutationFn: async ({ reviewId, managerRating, summary }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_performance_review", { companyId: companyId ?? null, reviewId: reviewId, params: stdbParamsToJson({ managerRating, summary: summary ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateBenefitPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { name: string; description?: string; planType: string; active?: boolean }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_benefit_plan", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          planType: params.planType,
          active: params.active ?? true,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-plans', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAssignBenefitEnrollment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { planId: number; employeeId: number; effectiveFrom?: Date }
  >({
    mutationFn: async ({ planId, employeeId, effectiveFrom }) => {
      const { urlPath, init } = stdbBffCommandPost("assign_benefit_enrollment", { companyId: companyId ?? null, params: stdbParamsToJson({
          planId,
          employeeId,
          effectiveFrom: stbTimestampFromDate(effectiveFrom ?? new Date()),
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)] })
    },
  })
}

export function useUnenrollBenefitEnrollment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (enrollmentId) => {
      const { urlPath, init } = stdbBffCommandPost("unenroll_benefit_enrollment", { companyId: companyId ?? null, enrollmentId: enrollmentId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)] })
    },
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

export function useCreateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateLeaveTypeParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_leave_type", { companyId: companyId, params: stdbParamsToJson(params, "CreateLeaveTypeParams") })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateLeaveType(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { leaveTypeId: ScalarId; params: Partial<UpdateLeaveTypeParams> }>({
    mutationFn: async ({ leaveTypeId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_leave_type", { companyId: companyId, leaveTypeId: toScalarU64(leaveTypeId), params: stdbParamsToJson(finalizeUpdateLeaveTypeParams(params)) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update leave type')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

export function useSubmitLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("submit_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to submit leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useApproveLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("approve_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useRefuseLeave(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("refuse_leave", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refuse leave')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

export function useResetLeaveToDraft(organizationId: bigint, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, ScalarId>({
    mutationFn: async (leaveId) => {
      const { urlPath, init } = stdbBffCommandPost("reset_leave_to_draft", { companyId: companyId, leaveId: toScalarU64(leaveId) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to reset leave to draft')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] })
    },
  })
}

// ── Mutations: Contract Workflow ────────────────────────────────────────────

export function useUpdateContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number; params: Partial<UpdateContractParams> }>({
    mutationFn: async ({ contractId, params }) => {
      const patch = { ...params, companyId: params.companyId ?? companyId }
      const { urlPath, init } = stdbBffCommandPost("update_contract", { contractId: contractId, params: stdbParamsToJson(patch) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update contract')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-compensation-events', rqBigIntKey(organizationId)] })
    },
  })
}

export function useOpenContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = stdbBffCommandPost("open_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to open contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useExpireContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { contractId: number }>({
    mutationFn: async ({ contractId }) => {
      const { urlPath, init } = stdbBffCommandPost("expire_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to expire contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelContract(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (contractId) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_contract", { companyId: companyId ?? null, contractId: contractId })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel contract')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

// ── Mutations: Payroll ───────────────────────────────────────────────────────

export function useCreatePayrollStructure(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreatePayrollStructureParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_payroll_structure", { params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payroll structure')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateSalaryRule(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateSalaryRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_salary_rule", { params: stdbParamsToJson(params) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create salary rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useConfirmPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { payslipId: number; grossWage?: number; netWage?: number; calculationSource?: string }>({
    mutationFn: async ({ payslipId, grossWage, netWage, calculationSource }) => {
      const { urlPath, init } = stdbBffCommandPost("confirm_payslip", { payslipId: toScalarU64(payslipId), params: stdbParamsToJson({
            companyId: companyId != null ? toScalarU64(companyId) : undefined,
            grossWage: grossWage ?? 0,
            netWage: netWage ?? 0,
            calculationSource: calculationSource ?? "manual",
          }) })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to approve payslip for export')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

export function useCreatePayrollExportIntent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { payslipId: number; idempotencyKey: string; payload: string; packKey?: string }
  >({
    mutationFn: async ({ payslipId, idempotencyKey, payload, packKey }) => {
      const { urlPath, init } = stdbBffCommandPost("create_payroll_export_intent", { companyId: companyId ?? null, payslipId: toScalarU64(payslipId), params: stdbParamsToJson({
          idempotencyKey,
          payload,
          packKey,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payroll export intent')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

/** Pending HR statutory/partner integration intents (bounded SQL). */
export function useHrIntegrationIntentsPending(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-integration-intents-pending', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/hr-integration-intents',
        'Failed to fetch HR integration intents',
      ),
    staleTime: 15_000,
    initialData,
  })
}

export function useCreateHrIntegrationIntent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      intentKind: string
      idempotencyKey: string
      payload: string
      payslipId?: number
      exportIntentId?: number
      metadata?: string
    }
  >({
    mutationFn: async ({
      intentKind,
      idempotencyKey,
      payload,
      payslipId,
      exportIntentId,
      metadata,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("create_hr_integration_intent", { params: stdbParamsToJson(
          {
            companyId,
            intentKind,
            idempotencyKey,
            payslipId: payslipId != null ? toScalarU64(payslipId) : undefined,
            exportIntentId:
              exportIntentId != null ? toScalarU64(exportIntentId) : undefined,
            payload,
            metadata,
          },
          'CreateHrIntegrationIntentParams',
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create HR integration intent')
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['hr-integration-intents-pending', rqBigIntKey(organizationId)],
      })
    },
  })
}

export function usePostPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      payslipId: number
      journalId: number
      expenseAccountId: number
      payableAccountId: number
      taxWithholdingAccountId?: number
      accountingDate: Date
    }
  >({
    mutationFn: async ({
      payslipId,
      journalId,
      expenseAccountId,
      payableAccountId,
      taxWithholdingAccountId,
      accountingDate,
    }) => {
      const { urlPath, init } = stdbBffCommandPost("post_payslip", { companyId: companyId ?? null, payslipId: toScalarU64(payslipId), params: stdbParamsToJson({
          journalId: toScalarU64(journalId),
          expenseAccountId: toScalarU64(expenseAccountId),
          payableAccountId: toScalarU64(payableAccountId),
          taxWithholdingAccountId:
            taxWithholdingAccountId != null ? toScalarU64(taxWithholdingAccountId) : undefined,
          accountingDate: stbTimestampFromDate(accountingDate),
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to post payslip to GL')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

export function useCancelPayslip(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (payslipId) => {
      const { urlPath, init } = stdbBffCommandPost("cancel_payslip", { companyId: payslipId, payslipId: companyId ?? null })

      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel payslip')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

// ── CSV imports (org + csv_data — no company_id in reducers) ───────────────────

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function useImportHrResourceCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_resource_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-resources', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrDepartmentCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_department_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-departments', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrJobPositionCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_job_position_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['job-positions', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrEmployeeCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_employee_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrContractCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_contract_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-contracts', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrLeaveTypeCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_leave_type_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-leave-types', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrLeaveCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_leave_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-leave-requests', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrPayrollStructureCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_payroll_structure_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-payroll-structures', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrSalaryRuleCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_salary_rule_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-salary-rules', rqBigIntKey(organizationId)] }),
  })
}

function useImportHrPayslipCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = stdbBffCommandPost("import_hr_payslip_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
  })
}

/** HR CSV import mutations for module toolbar (org-scoped reducers). */
export function useHrCsvImportMutations(organizationId: bigint) {
  return {
    importResource: useImportHrResourceCsv(organizationId),
    importDepartment: useImportHrDepartmentCsv(organizationId),
    importJobPosition: useImportHrJobPositionCsv(organizationId),
    importEmployee: useImportHrEmployeeCsv(organizationId),
    importContract: useImportHrContractCsv(organizationId),
    importLeaveType: useImportHrLeaveTypeCsv(organizationId),
    importLeave: useImportHrLeaveCsv(organizationId),
    importPayrollStructure: useImportHrPayrollStructureCsv(organizationId),
    importSalaryRule: useImportHrSalaryRuleCsv(organizationId),
    importPayslip: useImportHrPayslipCsv(organizationId),
  }
}

export type HrCsvImportMutations = ReturnType<typeof useHrCsvImportMutations>

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateContractParams,
  CreateDepartmentParams,
  CreateEmployeeParams,
  CreateJobPositionParams,
  CreateLeaveRequestParams,
  CreatePayslipParams,
} from '@lumiere/stdb/types'
