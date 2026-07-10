import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListAllowEmpty } from "@/lib/server-query"
import { ReportComposerPanel } from "./report-composer-panel"

export default async function AiHarnessPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ReportComposerPanel organizationId={0n} companies={[]} />
  }

  const companies = await serverFetchQueryListAllowEmpty(session, "companies")

  return (
    <ReportComposerPanel
      organizationId={BigInt(session.organizationId)}
      companies={companies}
    />
  )
}
