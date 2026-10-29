import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"
import { ProposalDataError } from "./proposal-data-error"
import { ProposalsClient } from "./proposals-client"

export default async function ProposalsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProposalsClient />
  }

  const proposals = await serverFetchQueryListState(session, "proposals")
  if (proposals.status === "denied" || proposals.status === "unavailable") {
    return <ProposalDataError status={proposals.status} message={proposals.message} />
  }

  return (
    <ProposalsClient
      initialProposals={proposals.rows}
      organizationId={session.organizationId}
    />
  )
}
