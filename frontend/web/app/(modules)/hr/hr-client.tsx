"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newEmployeeForm, newLeaveRequestForm, newContractForm, newPayslipForm, newJobPositionForm } from "@lumiere/ui"
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
} from "@lumiere/stdb"

interface HrClientProps {
  initialEmployees?: Record<string, unknown>[]
  initialDepartments?: Record<string, unknown>[]
  initialLeaves?: Record<string, unknown>[]
  initialContracts?: Record<string, unknown>[]
  initialPayslips?: Record<string, unknown>[]
  organizationId?: number
}

export function HrClient({
  initialEmployees,
  initialDepartments,
  initialLeaves,
  initialContracts,
  initialPayslips,
  organizationId,
}: HrClientProps) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: employees = [] } = useEmployees(companyId, initialEmployees)
  const { data: departments = [] } = useDepartments(companyId, initialDepartments)
  const { data: leaves = [] } = useLeaveRequests(companyId, initialLeaves)
  const { data: contracts = [] } = useContracts(companyId, initialContracts)
  const { data: payslips = [] } = usePayslips(companyId, initialPayslips)
  const { data: jobPositions = [] } = useJobPositions(companyId)

  const createEmployee = useCreateEmployee(orgId, companyId)
  const createLeaveRequest = useCreateLeaveRequest(orgId, companyId)
  const createContract = useCreateContract(orgId, companyId)
  const createPayslip = useCreatePayslip(orgId, companyId)

  const moduleConfig = useMemo(() => hrModuleConfig(t), [t])

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
                    { label: "Total Headcount", value: activeEmployees.length.toString(), icon: "Users" },
                    { label: "Open Positions", value: openPositions.toString(), icon: "UserPlus" },
                    { label: "Pending Leave Requests", value: pendingLeaves.toString(), icon: "Calendar" },
                    { label: "Running Contracts", value: runningContracts.toString(), icon: "FileText" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_employee: () => setQuickActionForm({ form: newEmployeeForm(t), action: "createEmployee" }),
                create_leave: () => setQuickActionForm({ form: newLeaveRequestForm(t), action: "createLeaveRequest" }),
                create_contract: () => setQuickActionForm({ form: newContractForm(t), action: "createContract" }),
                create_payslip: () => setQuickActionForm({ form: newPayslipForm(t), action: "createPayslip" }),
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
  }, [employees, departments, leaves, contracts, jobPositions, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections]
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
    if (action === "createEmployee") createEmployee.mutate(formData as never)
    else if (action === "createLeaveRequest") createLeaveRequest.mutate(formData as never)
    else if (action === "createContract") createContract.mutate(formData as never)
    else if (action === "createPayslip") createPayslip.mutate(formData as never)
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
        config={quickActionForm?.form ?? newEmployeeForm(t)}
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
