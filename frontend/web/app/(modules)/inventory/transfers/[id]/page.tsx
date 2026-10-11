import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { TransferPageClient } from "./transfer-page-client"

const SSR_RESOURCES = ["stock-pickings", "stock-moves", "stock-locations"] as const

interface TransferPageProps {
  params: Promise<{ id: string }>
}

export default async function TransferPage({ params }: TransferPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <TransferPageClient transferId={id} />
  }

  const [pickings, moves, locations] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <TransferPageClient
      transferId={id}
      initialPickings={pickings}
      initialMoves={moves}
      initialLocations={locations}
      organizationId={session.organizationId}
    />
  )
}
