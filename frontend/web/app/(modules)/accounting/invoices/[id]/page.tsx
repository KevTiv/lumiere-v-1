import { getStdbSession } from "@/lib/api-session"
import { InvoicePageClient } from "./invoice-page-client"

interface InvoicePageProps {
  params: Promise<{ id: string }>
}

/** Accounting reads are scoped to the active company, which is only known in the browser. */
export default async function InvoicePage({ params }: InvoicePageProps) {
  const { id } = await params
  const session = await getStdbSession()
  return <InvoicePageClient moveId={id} organizationId={session?.organizationId} />
}
