import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryEmployees,
  serverQueryDepartments,
  serverQueryLeaveRequests,
  serverQueryContracts,
  serverQueryPayslips,
} from "@lumiere/stdb/server"
import { HrClient } from "./hr-client"

export default async function HrPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <HrClient />
  }

  const [employees, departments, leaves, contracts, payslips] = await Promise.all([
    serverQueryEmployees(organizationId, opts),
    serverQueryDepartments(organizationId, opts),
    serverQueryLeaveRequests(organizationId, opts),
    serverQueryContracts(organizationId, opts),
    serverQueryPayslips(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <HrClient
      initialEmployees={employees as Record<string, unknown>[]}
      initialDepartments={departments as Record<string, unknown>[]}
      initialLeaves={leaves as Record<string, unknown>[]}
      initialContracts={contracts as Record<string, unknown>[]}
      initialPayslips={payslips as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
