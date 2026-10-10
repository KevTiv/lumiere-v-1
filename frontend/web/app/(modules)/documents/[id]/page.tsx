import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { DocumentPageClient } from "./document-page-client"

const SSR_RESOURCES = ["documents", "documents-deleted", "document-versions"] as const

interface DocumentPageProps {
  params: Promise<{ id: string }>
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <DocumentPageClient documentId={id} />
  }

  const [documents, deleted, versions] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <DocumentPageClient
      documentId={id}
      initialDocuments={documents}
      initialDeleted={deleted}
      initialVersions={versions}
      organizationId={session.organizationId}
    />
  )
}
