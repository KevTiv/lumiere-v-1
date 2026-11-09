import { getStdbSession } from "@/lib/api-session"

import { ImportJobPageClient } from "./import-job-page-client"

interface ImportJobPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ companyId?: string; fromTask?: string }>
}

export default async function ImportJobPage({ params, searchParams }: ImportJobPageProps) {
  const [{ id }, { companyId, fromTask }, session] = await Promise.all([params, searchParams, getStdbSession()])

  return (
    <ImportJobPageClient
      jobId={id}
      organizationId={session?.organizationId}
      fromTask={fromTask}
      fromCompanyId={companyId}
    />
  )
}
