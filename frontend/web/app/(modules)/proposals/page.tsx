import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryProposals } from "@lumiere/stdb/server"
import { ProposalsClient } from "./proposals-client"

export default async function ProposalsPage() {
  const { organizationId } = await getStdbSession()

  if (!organizationId) {
    return <ProposalsClient />
  }

  const initialProposals = await serverQueryProposals(BigInt(organizationId))

  return (
    <ProposalsClient
      initialProposals={initialProposals}
      organizationId={organizationId}
    />
  )
}
