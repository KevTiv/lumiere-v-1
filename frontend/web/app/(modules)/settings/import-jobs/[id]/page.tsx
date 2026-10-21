import { getStdbSession } from "@/lib/api-session"

import { ImportJobPageClient } from "./import-job-page-client"

interface ImportJobPageProps {
  params: Promise<{ id: string }>
}

export default async function ImportJobPage({ params }: ImportJobPageProps) {
  const { id } = await params
  const session = await getStdbSession()

  return (
    <ImportJobPageClient
      jobId={id}
      organizationId={session?.organizationId}
    />
  )
}
