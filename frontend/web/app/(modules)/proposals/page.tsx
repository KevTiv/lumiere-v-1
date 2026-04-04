import { getStdbSession } from "@/lib/api-session"
import { serverQueryProposals } from "@lumiere/stdb/server"
import { ProposalsClient } from "./proposals-client"

export default async function ProposalsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProposalsClient />
  }
  const { organizationId } = session

  const initialProposals = await serverQueryProposals(BigInt(organizationId))

  return (
    <ProposalsClient
      initialProposals={initialProposals}
      organizationId={organizationId}
    />
  )
}
