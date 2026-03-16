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

const ORG_ID = 1n
const COMPANY_ID = 1n

export default function HrPage() {
  const { data: employees = [] } = useEmployees(COMPANY_ID)
  const { data: departments = [] } = useDepartments(COMPANY_ID)
  const { data: leaves = [] } = useLeaveRequests(COMPANY_ID)
  const { data: contracts = [] } = useContracts(COMPANY_ID)
  const { data: payslips = [] } = usePayslips(COMPANY_ID)

  const createEmployee = useCreateEmployee(ORG_ID, COMPANY_ID)
  const createLeaveRequest = useCreateLeaveRequest(ORG_ID, COMPANY_ID)
  const createContract = useCreateContract(ORG_ID, COMPANY_ID)
  const createPayslip = useCreatePayslip(ORG_ID, COMPANY_ID)

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
