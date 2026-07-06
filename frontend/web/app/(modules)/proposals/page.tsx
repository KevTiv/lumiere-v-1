import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListAllowEmpty } from "@/lib/server-query"
import { ProposalsClient } from "./proposals-client"

export default async function ProposalsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProposalsClient />
  }

  const initialProposals = await serverFetchQueryListAllowEmpty(session, "proposals")

  return (
    <ProposalsClient
      initialProposals={initialProposals}
      organizationId={session.organizationId}
    />
  )
}
