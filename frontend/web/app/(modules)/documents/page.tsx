import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryDocuments, serverQueryKnowledgeArticles } from "@lumiere/stdb/server"
import { DocumentsClient } from "./documents-client"

export default async function DocumentsPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <DocumentsClient />
  }

  const [documents, articles] = await Promise.all([
    serverQueryDocuments(organizationId, opts),
    serverQueryKnowledgeArticles(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <DocumentsClient
      initialDocuments={documents as Record<string, unknown>[]}
      initialArticles={articles as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
