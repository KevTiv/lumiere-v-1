"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newEmployeeForm,
  newLeaveRequestForm,
  newContractForm,
  newPayslipForm,
  newJobPositionForm,
  newDepartmentForm,
  newLeaveTypeForm,
  newPayrollStructureForm,
  newSalaryRuleForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  hrCsvImportForm,
} from "@lumiere/ui"
import type { EntityViewConfig, FormConfig, HrCsvImportKind, ModuleConfig } from "@lumiere/ui"
import { hrModuleConfig } from "@/lib/module-dashboard-configs"
import { useHrModuleSubscription } from "@/lib/module-subscription-hooks"
import { groupBy } from "@/lib/utils"
import {
  useEmployees,
  useDepartments,
  useLeaveRequests,
  useContracts,
  usePayslips,
  useJobPositions,
  useLeaveTypes,
  usePayrollStructures,
  useSalaryRules,
  useCreateEmployee,
  useCreateLeaveRequest,
  useCreateContract,
  useCreatePayslip,
  useCreateJobPosition,
  useCreateDepartment,
  useCreateLeaveType,
  useCreatePayrollStructure,
  useCreateSalaryRule,
  useArchiveEmployee,
  useApproveLeave,
  useRefuseLeave,
  useResetLeaveToDraft,
  useOpenContract,
  useExpireContract,
  useCancelContract,
  useConfirmPayslip,
  useCancelPayslip,
  useHrCsvImportMutations,
} from "@lumiere/query-hooks/hooks/hr"
import { OrgChartPanel } from "./hr-panels"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import {
  toCreateContractParams,
  toCreateDepartmentParams,
  toCreateEmployeeParams,
  toCreateJobPositionParams,
  toCreateLeaveRequestParams,
  toCreateLeaveTypeParams,
  toCreatePayrollStructureParams,
  toCreatePayslipParams,
  toCreateSalaryRuleParams,
} from "@/lib/hr-create-params"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  departmentRowsToSelectOptions,
  leaveTypeRowsToSelectOptions,
  payrollStructureRowsToSelectOptions,
} from "@/lib/form-lookup"

export { HR_UI_REDUCERS } from "@/lib/hr-ui-reducers"

type HrRowAction =
  | { action: "archiveEmployee"; rows: Record<string, unknown>[]; form: FormConfig }
  | { action: "confirmPayslip"; rows: Record<string, unknown>[]; form: FormConfig }
  | null

const archiveEmployeeForm: FormConfig = {
  id: "archive-employee",
  title: "Archive Employee",
  submitLabel: "Archive employee",
  sections: [
    {
      id: "archive",
      fields: [
        {
          id: "termination-date",
          type: "date",
          name: "terminationDate",
          label: "Termination date",
        },
      ],
    },
  ],
}

const confirmPayslipForm: FormConfig = {
  id: "confirm-payslip",
  title: "Confirm Payslip",
  submitLabel: "Confirm payslip",
  sections: [
    {
      id: "wages",
      fields: [
        {
          id: "gross-wage",
          type: "number",
          name: "grossWage",
          label: "Gross wage",
          width: "1/2",
        },
        {
          id: "net-wage",
          type: "number",
          name: "netWage",
          label: "Net wage",
          width: "1/2",
        },
      ],
    },
  ],
}

interface HrClientProps {
  initialEmployees?: Record<string, unknown>[]
  initialDepartments?: Record<string, unknown>[]
  initialLeaves?: Record<string, unknown>[]
  initialContracts?: Record<string, unknown>[]
  initialPayslips?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  organizationId?: number
}

type HrClientLoadedProps = Omit<HrClientProps, "organizationId"> & {
  organizationId: number
}

export function HrClient(props: HrClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <HrClientLoaded {...props} organizationId={props.organizationId} />
}

function HrClientLoaded({
  initialEmployees,
  initialDepartments,
  initialLeaves,
  initialContracts,
  initialPayslips,
  initialPricelists,
  organizationId,
}: HrClientLoadedProps) {
  useHrModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvKind, setCsvKind] = useState<HrCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)
  const [rowAction, setRowAction] = useState<HrRowAction>(null)
  const [rowActionError, setRowActionError] = useState<string | null>(null)

  const { data: employees = [] } = useEmployees(orgId, initialEmployees)
  const { data: departments = [] } = useDepartments(orgId, initialDepartments)
  const { data: leaves = [] } = useLeaveRequests(orgId, initialLeaves)
  const { data: contracts = [] } = useContracts(orgId, initialContracts)
  const { data: payslips = [] } = usePayslips(orgId, initialPayslips)
  const { data: jobPositions = [] } = useJobPositions(orgId)
  const { data: leaveTypes = [] } = useLeaveTypes(orgId)
  const { data: payrollStructures = [] } = usePayrollStructures(orgId)
  const { data: salaryRules = [] } = useSalaryRules(orgId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)

  const createEmployee = useCreateEmployee(orgId, operatingCompanyId)
  const createLeaveRequest = useCreateLeaveRequest(orgId, operatingCompanyId)
  const createContract = useCreateContract(orgId, operatingCompanyId)
  const createPayslip = useCreatePayslip(orgId, operatingCompanyId)
  const createJobPosition = useCreateJobPosition(orgId, operatingCompanyId)
  const createDepartment = useCreateDepartment(orgId, operatingCompanyId)
  const createLeaveType = useCreateLeaveType(orgId, operatingCompanyId)
  const createPayrollStructure = useCreatePayrollStructure(orgId, operatingCompanyId)
  const createSalaryRule = useCreateSalaryRule(orgId, operatingCompanyId)
  const archiveEmployee = useArchiveEmployee(orgId, operatingCompanyId)
  const approveLeave = useApproveLeave(orgId)
  const refuseLeave = useRefuseLeave(orgId)
  const resetLeave = useResetLeaveToDraft(orgId)
  const openContract = useOpenContract(orgId)
  const expireContract = useExpireContract(orgId)
  const cancelContract = useCancelContract(orgId)
  const confirmPayslip = useConfirmPayslip(orgId, operatingCompanyId)
  const cancelPayslip = useCancelPayslip(orgId, operatingCompanyId)
  const csvImports = useHrCsvImportMutations(orgId)

  const moduleConfig = useMemo(() => hrModuleConfig(t), [t])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{
      id: string
      label: string
      requiresSelection?: boolean
      onClick: (selectedRows: Record<string, unknown>[]) => void
    }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

  const runSelectedRows = async (
    rows: Record<string, unknown>[],
    label: string,
    fn: (row: Record<string, unknown>) => Promise<unknown>,
  ) => {
    setToolbarError(null)
    if (rows.length === 0) {
      setToolbarError(`Select at least one ${label}.`)
      return
    }
    try {
      for (const row of rows) await fn(row)
    } catch (e) {
      setToolbarError(e instanceof Error ? e.message : String(e))
    }
  }

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(employees as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, t])

  const departmentFieldOptions = useMemo(() => {
    const fromApi = departmentRowsToSelectOptions(departments as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noDepartments"), disabled: true }]
  }, [departments, t])

  const leaveTypeFieldOptions = useMemo(() => {
    const fromApi = leaveTypeRowsToSelectOptions(leaveTypes as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noLeaveTypes"), disabled: true }]
  }, [leaveTypes, t])

  const payrollStructureFieldOptions = useMemo(() => {
    const fromApi = payrollStructureRowsToSelectOptions(payrollStructures as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPayrollStructures"), disabled: true }]
  }, [payrollStructures, t])

  const employeeFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newEmployeeForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const leaveFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newLeaveRequestForm(t), {
        employeeId: employeeFieldOptions,
        leaveTypeId: leaveTypeFieldOptions,
      }),
    [t, employeeFieldOptions, leaveTypeFieldOptions],
  )

  const contractFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newContractForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions],
  )

  const jobFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newJobPositionForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const payslipFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPayslipForm(t), {
        structId: payrollStructureFieldOptions,
      }),
    [t, payrollStructureFieldOptions],
  )

  const salaryRuleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSalaryRuleForm(t), {
        structureId: payrollStructureFieldOptions,
      }),
    [t, payrollStructureFieldOptions],
  )

  const recruitmentPositions = useMemo(
    () => jobPositions.filter((j) => String(j.state ?? "") === "recruit"),
    [jobPositions],
  )

  const orgChartTab = useMemo(
    () => ({
      id: "org-chart",
      label: "Org Chart",
      type: "custom" as const,
      customContent: (
        <OrgChartPanel
          departments={departments as Record<string, unknown>[]}
          employees={employees as Record<string, unknown>[]}
        />
      ),
    }),
    [departments, employees],
  )

  const liveSections = useMemo(() => {
    const activeEmployees = employees.filter((e) => e.isActive)
    const pendingLeaves = leaves.filter((l) => String(l.state) === "Confirm").length
    const runningContracts = contracts.filter((c) => String(c.state) === "Open").length
    const openPositions = jobPositions.filter((j) => String(j.state) === "recruit").length

    return (
      moduleConfig.tabs
        .find((tab) => tab.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: t("hr.dashboard.totalHeadcount"), value: activeEmployees.length.toString(), icon: "Users" },
                    { label: t("hr.dashboard.openPositions"), value: openPositions.toString(), icon: "UserPlus" },
                    { label: t("hr.dashboard.pendingLeaveRequests"), value: pendingLeaves.toString(), icon: "Calendar" },
                    { label: t("hr.dashboard.runningContracts"), value: runningContracts.toString(), icon: "FileText" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_employee: () => setQuickActionForm({ form: employeeFormConfig, action: "createEmployee" }),
                create_leave: () => setQuickActionForm({ form: leaveFormConfig, action: "createLeaveRequest" }),
                create_contract: () => setQuickActionForm({ form: contractFormConfig, action: "createContract" }),
                create_payslip: () => setQuickActionForm({ form: payslipFormConfig, action: "createPayslip" }),
                create_job_position: () => setQuickActionForm({ form: jobFormConfig, action: "createJobPosition" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "hr-by-department") {
              const byDept = groupBy(
                employees.filter((e) => e.isActive),
                (e) => {
                  if (!e.departmentId) return "Other"
                  const dept = departments.find((d) => d.id === e.departmentId)
                  return String(dept?.name ?? `Dept ${String(e.departmentId).slice(-4)}`)
                },
              )
              const values = Object.entries(byDept)
                .map(([dept, emps]) => ({ dept, Employees: emps.length }))
                .sort((a, b) => b.Employees - a.Employees)
                .slice(0, 7)
              return { ...w, data: { ...(w.data as Record<string, unknown>), values } }
            }
            if (w.id === "hr-leave-usage") {
              const byType = groupBy(leaves, (l) => `Type ${String(l.leaveTypeId ?? "0").slice(-4)}`)
              const colors = ["#6366f1", "#f59e0b", "#22c55e", "#8b5cf6"]
              const totalDays = leaves.reduce((s, l) => s + Number(l.numberOfDays ?? 0), 0)
              const metrics = Object.entries(byType)
                .map(([label, typeLeaves]) => ({
                  label,
                  value: Math.round(typeLeaves.reduce((s, l) => s + Number(l.numberOfDays ?? 0), 0)),
                  max: Math.max(1, Math.round(totalDays)),
                  color: "#6366f1",
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 4)
                .map((m, i) => ({ ...m, color: colors[i] ?? "#6366f1" }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "hr-open-roles") {
              const rows = jobPositions
                .filter((j) => String(j.state ?? "") === "recruit")
                .slice(0, 5)
                .map((j) => {
                  const dept = departments.find((d) => d.id === j.departmentId)
                  return {
                    role: String(j.name ?? ""),
                    dept: String(dept?.name ?? "—"),
                    candidates: 0,
                    stage: "Open",
                    posted: "—",
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows } }
            }
            return w
          }),
        })) ??
      moduleConfig.tabs.find((tab) => tab.id === "dashboard")?.sections ??
      []
    )
  }, [
    employees,
    departments,
    leaves,
    contracts,
    jobPositions,
    moduleConfig,
    t,
    employeeFormConfig,
    leaveFormConfig,
    contractFormConfig,
    jobFormConfig,
  ])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return hrCsvImportForm(t, csvKind)
  }, [csvKind, t])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: [
          orgChartTab,
          ...moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "employees" && tab.entityConfig) {
            return {
              ...tab,
              createForm: employeeFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-employee",
                  label: t("hr.toolbar.importEmployeeCsv"),
                  onClick: () => setCsvKind("employee"),
                },
                {
                  id: "archive-employee",
                  label: "Archive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    if (rows.length === 0) {
                      setToolbarError("Select at least one employee.")
                      return
                    }
                    setRowActionError(null)
                    setRowAction({ action: "archiveEmployee", rows, form: archiveEmployeeForm })
                  },
                },
              ]),
            }
          }
          if (tab.id === "departments" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newDepartmentForm(t),
              createLabel: "New Department",
              createAction: "createDepartment",
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-department",
                  label: t("hr.toolbar.importDepartmentCsv"),
                  onClick: () => setCsvKind("department"),
                },
              ]),
            }
          }
          if (tab.id === "leaves" && tab.entityConfig) {
            return {
              ...tab,
              createForm: leaveFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-leave-type",
                  label: t("hr.toolbar.importLeaveTypeCsv"),
                  onClick: () => setCsvKind("leave_type"),
                },
                {
                  id: "csv-leave",
                  label: t("hr.toolbar.importLeaveCsv"),
                  onClick: () => setCsvKind("leave"),
                },
                {
                  id: "approve-leave",
                  label: "Approve",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => approveLeave.mutateAsync(row.id as string | number)),
                },
                {
                  id: "refuse-leave",
                  label: "Refuse",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => refuseLeave.mutateAsync(row.id as string | number)),
                },
                {
                  id: "reset-leave",
                  label: "Reset to draft",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => resetLeave.mutateAsync(row.id as string | number)),
                },
              ]),
            }
          }
          if (tab.id === "contracts" && tab.entityConfig) {
            return {
              ...tab,
              createForm: contractFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-contract",
                  label: t("hr.toolbar.importContractCsv"),
                  onClick: () => setCsvKind("contract"),
                },
                {
                  id: "open-contract",
                  label: "Open",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => openContract.mutateAsync(Number(row.id))),
                },
                {
                  id: "expire-contract",
                  label: "Expire",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => expireContract.mutateAsync({ contractId: Number(row.id) })),
                },
                {
                  id: "cancel-contract",
                  label: "Cancel",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => cancelContract.mutateAsync(Number(row.id))),
                },
              ]),
            }
          }
          if (tab.id === "payslips" && tab.entityConfig) {
            return {
              ...tab,
              createForm: payslipFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-payroll-structure",
                  label: t("hr.toolbar.importPayrollStructureCsv"),
                  onClick: () => setCsvKind("payroll_structure"),
                },
                {
                  id: "csv-salary-rule",
                  label: t("hr.toolbar.importSalaryRuleCsv"),
                  onClick: () => setCsvKind("salary_rule"),
                },
                {
                  id: "csv-payslip",
                  label: t("hr.toolbar.importPayslipCsv"),
                  onClick: () => setCsvKind("payslip"),
                },
                {
                  id: "confirm-payslip",
                  label: "Confirm",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    if (rows.length === 0) {
                      setToolbarError("Select at least one payslip.")
                      return
                    }
                    setRowActionError(null)
                    setRowAction({ action: "confirmPayslip", rows, form: confirmPayslipForm })
                  },
                },
                {
                  id: "cancel-payslip",
                  label: "Cancel",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "payslip", (row) => cancelPayslip.mutateAsync(Number(row.id))),
                },
              ]),
            }
          }
          if (tab.id === "job-positions" && tab.entityConfig) {
            return {
              ...tab,
              createForm: jobFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-job-position",
                  label: t("hr.toolbar.importJobPositionCsv"),
                  onClick: () => setCsvKind("job_position"),
                },
                {
                  id: "csv-resource",
                  label: t("hr.toolbar.importResourceCsv"),
                  onClick: () => setCsvKind("resource"),
                },
              ]),
            }
          }
          if (tab.id === "recruitment" && tab.entityConfig) {
            return {
              ...tab,
              createForm: mergeSelectOptionsForFields(newJobPositionForm(t), {
                departmentId: departmentFieldOptions,
              }),
              entityConfig: {
                ...tab.entityConfig,
                title: t("hr.recruitment.title"),
                description: t("hr.recruitment.description"),
              },
            }
          }
          if (tab.id === "leave-types" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newLeaveTypeForm(t),
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-leave-type",
                  label: t("hr.toolbar.importLeaveTypeCsv"),
                  onClick: () => setCsvKind("leave_type"),
                },
              ]),
            }
          }
          if (tab.id === "payroll-structures" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newPayrollStructureForm(t),
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-payroll-structure",
                  label: t("hr.toolbar.importPayrollStructureCsv"),
                  onClick: () => setCsvKind("payroll_structure"),
                },
              ]),
            }
          }
          if (tab.id === "salary-rules" && tab.entityConfig) {
            return {
              ...tab,
              createForm: salaryRuleFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-salary-rule",
                  label: t("hr.toolbar.importSalaryRuleCsv"),
                  onClick: () => setCsvKind("salary_rule"),
                },
              ]),
            }
          }
          return tab
        }),
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      orgChartTab,
      liveSections,
      employeeFormConfig,
      leaveFormConfig,
      contractFormConfig,
      payslipFormConfig,
      jobFormConfig,
      salaryRuleFormConfig,
      departmentFieldOptions,
      t,
      approveLeave,
      refuseLeave,
      resetLeave,
      openContract,
      expireContract,
      cancelContract,
      cancelPayslip,
    ],
  )

  const data = useMemo(
    () => ({
      employees: employees as unknown as Record<string, unknown>[],
      departments: departments as unknown as Record<string, unknown>[],
      leaves: leaves as unknown as Record<string, unknown>[],
      contracts: contracts as unknown as Record<string, unknown>[],
      payslips: payslips as unknown as Record<string, unknown>[],
      "job-positions": jobPositions as unknown as Record<string, unknown>[],
      recruitment: recruitmentPositions as unknown as Record<string, unknown>[],
      "leave-types": leaveTypes as unknown as Record<string, unknown>[],
      "payroll-structures": payrollStructures as unknown as Record<string, unknown>[],
      "salary-rules": salaryRules as unknown as Record<string, unknown>[],
    }),
    [employees, departments, leaves, contracts, payslips, jobPositions, recruitmentPositions, leaveTypes, payrollStructures, salaryRules]
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createEmployee") {
      await createEmployee.mutateAsync(toCreateEmployeeParams(formData))
    } else if (action === "createLeaveRequest") {
      const empRaw = formData.employeeId
      const ltRaw = formData.leaveTypeId
      if (empRaw === "" || empRaw == null || ltRaw === "" || ltRaw == null) return
      const params = toCreateLeaveRequestParams(formData)
      if (params === null) return
      await createLeaveRequest.mutateAsync(params)
    } else if (action === "createContract") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const params = toCreateContractParams(formData, {
        currencyId: pl.currencyId,
        pricelistId: plRaw,
      })
      if (params === null) return
      await createContract.mutateAsync(params)
    } else if (action === "createPayslip") {
      const params = toCreatePayslipParams(formData)
      if (params === null) return
      await createPayslip.mutateAsync(params)
    } else if (action === "createJobPosition") {
      await createJobPosition.mutateAsync(toCreateJobPositionParams(formData))
    } else if (action === "createDepartment") {
      await createDepartment.mutateAsync(toCreateDepartmentParams(formData))
    } else if (action === "createLeaveType") {
      const params = toCreateLeaveTypeParams(formData)
      await createLeaveType.mutateAsync(params)
    } else if (action === "createPayrollStructure") {
      await createPayrollStructure.mutateAsync(toCreatePayrollStructureParams(formData))
    } else if (action === "createSalaryRule") {
      const params = toCreateSalaryRuleParams(formData)
      if (!params) return
      await createSalaryRule.mutateAsync(params)
    }
  }

  const isFormMutationPending =
    createEmployee.isPending ||
    createLeaveRequest.isPending ||
    createContract.isPending ||
    createPayslip.isPending ||
    createJobPosition.isPending ||
    createDepartment.isPending ||
    createLeaveType.isPending ||
    createPayrollStructure.isPending ||
    createSalaryRule.isPending ||
    archiveEmployee.isPending ||
    approveLeave.isPending ||
    refuseLeave.isPending ||
    resetLeave.isPending ||
    openContract.isPending ||
    expireContract.isPending ||
    cancelContract.isPending ||
    confirmPayslip.isPending ||
    cancelPayslip.isPending ||
    Object.values(csvImports).some((m) => m.isPending)

  return (
    <>
      {toolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {toolbarError}
        </p>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? employeeFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {rowAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setRowAction(null)
              setRowActionError(null)
            }
          }}
          config={rowAction.form}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={rowActionError}
          onSubmit={async (formData) => {
            setRowActionError(null)
            try {
              if (rowAction.action === "archiveEmployee") {
                for (const row of rowAction.rows) {
                  await archiveEmployee.mutateAsync({
                    employeeId: Number(row.id),
                    terminationDate:
                      formData.terminationDate != null && formData.terminationDate !== ""
                        ? new Date(String(formData.terminationDate))
                        : undefined,
                  })
                }
              } else if (rowAction.action === "confirmPayslip") {
                for (const row of rowAction.rows) {
                  await confirmPayslip.mutateAsync({
                    payslipId: Number(row.id),
                    grossWage: Number(formData.grossWage) || 0,
                    netWage: Number(formData.netWage) || 0,
                  })
                }
              }
              setRowAction(null)
            } catch (e) {
              setRowActionError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              switch (csvKind) {
                case "resource":
                  await csvImports.importResource.mutateAsync(text)
                  break
                case "department":
                  await csvImports.importDepartment.mutateAsync(text)
                  break
                case "job_position":
                  await csvImports.importJobPosition.mutateAsync(text)
                  break
                case "employee":
                  await csvImports.importEmployee.mutateAsync(text)
                  break
                case "contract":
                  await csvImports.importContract.mutateAsync(text)
                  break
                case "leave_type":
                  await csvImports.importLeaveType.mutateAsync(text)
                  break
                case "leave":
                  await csvImports.importLeave.mutateAsync(text)
                  break
                case "payroll_structure":
                  await csvImports.importPayrollStructure.mutateAsync(text)
                  break
                case "salary_rule":
                  await csvImports.importSalaryRule.mutateAsync(text)
                  break
                case "payslip":
                  await csvImports.importPayslip.mutateAsync(text)
                  break
                default:
                  break
              }
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}
