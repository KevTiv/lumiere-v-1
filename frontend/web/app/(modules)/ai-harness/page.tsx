import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListAllowEmpty } from "@/lib/server-query"
import { AiHarnessClient } from "./ai-harness-client"

export default async function AiHarnessPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <AiHarnessClient organizationId={0n} companies={[]} />
  }

  const companies = await serverFetchQueryListAllowEmpty(session, "companies")

  return (
    <AiHarnessClient
      organizationId={BigInt(session.organizationId)}
      companies={companies}
    />
  )
}
