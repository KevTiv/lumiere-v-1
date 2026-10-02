"use client"

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, rqBigIntKey } from "../../http"
import { importContentSha256, resolveCommittedImportJob, type ImportJobEffect } from "../import-job-effect"
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

/**
 * COV-22: committing a payslip CSV is idempotent by content (the server records the
 * file's SHA-256 on its import job), so the effect is read back by that identity: the
 * one import job that committed this content, never the newest job.
 */
function useImportHrPayslipCsv(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<ImportJobEffect, Error, string>({
    mutationFn: async (csvData) => {
      const contentSha256 = await importContentSha256("hr_payslip", csvData)
      const { urlPath, init } = stdbBffCommandPost("import_hr_payslip_csv", { csvData: csvData })

      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallError(res))
      const jobs = await fetchQueryList("/api/query/import-jobs", "Failed to read import job")
      const effect = resolveCommittedImportJob(jobs, organizationId, "hr_payslip", contentSha256)
      if (!effect) throw new Error("Payslip import committed no rows; check the import errors")
      return effect
    },
    onSuccess: () =>
      void Promise.all([
        qc.invalidateQueries({ queryKey: ['hr-payslips', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['import-jobs', rqBigIntKey(organizationId)] }),
      ]),
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
