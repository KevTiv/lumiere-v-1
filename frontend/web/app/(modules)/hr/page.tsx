import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { HrClient } from "./hr-client"

const SSR_RESOURCES = [
  "employees",
  "departments",
  "leave-requests",
  "contracts",
  "payslips",
  "pricelists",
] as const

export default async function HrPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <HrClient />
  }

  const [employees, departments, leaves, contracts, payslips, pricelists] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <HrClient
      initialEmployees={employees}
      initialDepartments={departments}
      initialLeaves={leaves}
      initialContracts={contracts}
      initialPayslips={payslips}
      initialPricelists={pricelists}
      organizationId={session.organizationId}
    />
  )
}
