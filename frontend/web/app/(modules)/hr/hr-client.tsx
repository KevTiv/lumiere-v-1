"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { hrModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useEmployees,
  useDepartments,
  useLeaveRequests,
  useContracts,
  usePayslips,
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
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: employees = [] } = useEmployees(companyId, initialEmployees)
  const { data: departments = [] } = useDepartments(companyId, initialDepartments)
  const { data: leaves = [] } = useLeaveRequests(companyId, initialLeaves)
  const { data: contracts = [] } = useContracts(companyId, initialContracts)
  const { data: payslips = [] } = usePayslips(companyId, initialPayslips)

  const createEmployee = useCreateEmployee(orgId, companyId)
  const createLeaveRequest = useCreateLeaveRequest(orgId, companyId)
  const createContract = useCreateContract(orgId, companyId)
  const createPayslip = useCreatePayslip(orgId, companyId)

  const liveSections = useMemo(() => {
    const activeEmployees = employees.filter((e) => e.isActive)
    const pendingLeaves = leaves.filter((l) => String(l.state) === "Confirm").length
    const runningContracts = contracts.filter((c) => String(c.state) === "Open").length

    return (
      hrModuleConfig.tabs
        .find((t) => t.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: "Total Headcount", value: activeEmployees.length.toString(), icon: "Users" },
                    { label: "Departments", value: departments.length.toString(), icon: "Building" },
                    { label: "Pending Leave Requests", value: pendingLeaves.toString(), icon: "Calendar" },
                    { label: "Running Contracts", value: runningContracts.toString(), icon: "FileText" },
                  ],
                },
              }
            }
            return w
          }),
        })) ??
      hrModuleConfig.tabs.find((t) => t.id === "dashboard")?.sections ??
      []
    )
  }, [employees, departments, leaves, contracts])

  const config = useMemo(
    () => ({
      ...hrModuleConfig,
      tabs: hrModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }),
    [liveSections]
  )

  const data = useMemo(
    () => ({
      employees: employees as unknown as Record<string, unknown>[],
      departments: departments as unknown as Record<string, unknown>[],
      leaves: leaves as unknown as Record<string, unknown>[],
      contracts: contracts as unknown as Record<string, unknown>[],
      payslips: payslips as unknown as Record<string, unknown>[],
    }),
    [employees, departments, leaves, contracts, payslips]
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
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
