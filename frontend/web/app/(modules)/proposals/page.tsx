import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"
import { ProposalsClient } from "./proposals-client"

export default async function ProposalsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProposalsClient />
  }

  const proposals = await serverFetchQueryListState(session, "proposals")
  if (proposals.status === "denied" || proposals.status === "unavailable") {
    return (
      <main className="p-6" role="alert">
        Proposal data {proposals.status}: {proposals.message}
      </main>
    )
  }

  return (
    <ProposalsClient
      initialProposals={proposals.rows}
      organizationId={session.organizationId}
    />
  )
}
