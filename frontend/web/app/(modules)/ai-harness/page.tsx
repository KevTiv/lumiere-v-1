import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"
import { AiHarnessClient, CompanyDataError } from "./ai-harness-client"

export default async function AiHarnessPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AiHarnessClient organizationId={0n} companies={[]} />
  }

  const companies = await serverFetchQueryListState(session, "companies")
  if (companies.status === "denied" || companies.status === "unavailable") {
    return <CompanyDataError status={companies.status} message={companies.message} />
  }

  return (
    <AiHarnessClient
      organizationId={BigInt(session.organizationId)}
      companies={companies.rows}
    />
  )
}
