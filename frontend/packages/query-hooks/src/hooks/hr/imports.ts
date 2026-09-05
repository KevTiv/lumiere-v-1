"use client"

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
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
