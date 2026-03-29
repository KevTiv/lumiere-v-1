"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newEmployeeForm,
  newLeaveRequestForm,
  newContractForm,
  newPayslipForm,
  newJobPositionForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { hrModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  useEmployees,
  useDepartments,
  useLeaveRequests,
  useContracts,
  usePayslips,
  useJobPositions,
  useCreateEmployee,
  useCreateLeaveRequest,
  useCreateContract,
  useCreatePayslip,
  useCreateJobPosition,
} from "@/hooks/hr"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { usePricelists } from "@/hooks/sales"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  departmentRowsToSelectOptions,
  leaveTypeOptionsFromLeaveRequests,
} from "@/lib/form-lookup"

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
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: employees = [] } = useEmployees(companyId, initialEmployees)
  const { data: departments = [] } = useDepartments(companyId, initialDepartments)
  const { data: leaves = [] } = useLeaveRequests(companyId, initialLeaves)
  const { data: contracts = [] } = useContracts(companyId, initialContracts)
  const { data: payslips = [] } = usePayslips(companyId, initialPayslips)
  const { data: jobPositions = [] } = useJobPositions(companyId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)

  const createEmployee = useCreateEmployee(orgId, companyId)
  const createLeaveRequest = useCreateLeaveRequest(orgId, companyId)
  const createContract = useCreateContract(orgId, companyId)
  const createPayslip = useCreatePayslip(orgId, companyId)
  const createJobPosition = useCreateJobPosition(orgId, companyId)

  const moduleConfig = useMemo(() => hrModuleConfig(t), [t])

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
    const fromApi = leaveTypeOptionsFromLeaveRequests(leaves as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noLeaveTypes"), disabled: true }]
  }, [leaves, t])

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
                create_payslip: () => setQuickActionForm({ form: newPayslipForm(t), action: "createPayslip" }),
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

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "employees") return { ...tab, createForm: employeeFormConfig }
          if (tab.id === "leaves") return { ...tab, createForm: leaveFormConfig }
          if (tab.id === "contracts") return { ...tab, createForm: contractFormConfig }
          if (tab.id === "job-positions") return { ...tab, createForm: jobFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, employeeFormConfig, leaveFormConfig, contractFormConfig, jobFormConfig],
  )

  const data = useMemo(
    () => ({
      employees: employees as unknown as Record<string, unknown>[],
      departments: departments as unknown as Record<string, unknown>[],
      leaves: leaves as unknown as Record<string, unknown>[],
      contracts: contracts as unknown as Record<string, unknown>[],
      payslips: payslips as unknown as Record<string, unknown>[],
      "job-positions": jobPositions as unknown as Record<string, unknown>[],
    }),
    [employees, departments, leaves, contracts, payslips, jobPositions]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createEmployee") {
      const deptRaw = formData.departmentId
      createEmployee.mutate({
        name: String(formData.name ?? ""),
        jobId: undefined,
        departmentId:
          deptRaw !== "" && deptRaw != null ? Number(deptRaw) : undefined,
        employmentType: String(formData.employmentType ?? "FullTime"),
        workEmail: formData.workEmail ? String(formData.workEmail) : undefined,
        employeeNumber: undefined,
        jobTitle: formData.jobTitle ? String(formData.jobTitle) : undefined,
        parentId: undefined,
        coachId: undefined,
        workPhone: formData.workPhone ? String(formData.workPhone) : undefined,
        mobilePhone: undefined,
        workLocation: formData.workLocation ? String(formData.workLocation) : undefined,
        dateHired: formData.dateHired ? new Date(String(formData.dateHired)) : undefined,
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
      } as never)
    } else if (action === "createLeaveRequest") {
      const empRaw = formData.employeeId
      const ltRaw = formData.leaveTypeId
      if (empRaw === "" || empRaw == null || ltRaw === "" || ltRaw == null) return
      createLeaveRequest.mutate({
        employeeId: Number(empRaw),
        leaveTypeId: Number(ltRaw),
        dateFrom: new Date(String(formData.dateFrom)),
        dateTo: new Date(String(formData.dateTo)),
        numberOfDays: Number(formData.numberOfDays ?? 0),
        notes: formData.notes ? String(formData.notes) : undefined,
        name: undefined,
        managerId: undefined,
      } as never)
    } else if (action === "createContract") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      createContract.mutate({
        employeeId: Number(empRaw),
        name: String(formData.name ?? ""),
        dateStart: new Date(String(formData.dateStart)),
        wage: Number(formData.wage ?? 0),
        currencyId: Number(pl.currencyId),
        jobId: undefined,
        departmentId: undefined,
        dateEnd: formData.dateEnd ? new Date(String(formData.dateEnd)) : undefined,
        notes: undefined,
      } as never)
    } else if (action === "createPayslip") {
      createPayslip.mutate({
        employeeId: Number(formData.employeeId),
        structId: Number(formData.structId),
        dateFrom: new Date(String(formData.dateFrom)),
        dateTo: new Date(String(formData.dateTo)),
        basicWage: Number(formData.basicWage ?? 0),
        contractId: formData.contractId != null ? Number(formData.contractId) : undefined,
        notes: undefined,
      } as never)
    } else if (action === "createJobPosition") {
      const deptRaw = formData.departmentId
      createJobPosition.mutate({
        name: String(formData.name ?? ""),
        departmentId:
          deptRaw !== "" && deptRaw != null ? BigInt(Number(deptRaw)) : undefined,
        expectedEmployees: Number(formData.expectedEmployees ?? 1),
        description: formData.description as string | undefined,
        requirements: formData.requirements as string | undefined,
        state: String(formData.state ?? "recruit"),
        isActive: formData.isActive == null ? true : Boolean(formData.isActive),
      } as never)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? employeeFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
