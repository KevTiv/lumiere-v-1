import { getStdbSession } from "@/lib/api-session"
import { TransferPageClient } from "./transfer-page-client"

interface TransferPageProps {
  params: Promise<{ id: string }>
}

export default async function TransferPage({ params }: TransferPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  return <TransferPageClient transferId={id} organizationId={session?.organizationId} />
}
