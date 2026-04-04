import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryDocuments,
  serverQueryKnowledgeArticles,
  serverQueryAiDocumentProcessingJobs,
  serverQueryAiInsights,
} from "@lumiere/stdb/server"
import { DocumentsClient } from "./documents-client"

export default async function DocumentsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <DocumentsClient />
  }
  const { organizationId, opts } = session

  const [documents, articles, processingJobs, insights] = await Promise.all([
    serverQueryDocuments(organizationId, opts),
    serverQueryKnowledgeArticles(organizationId, opts),
    serverQueryAiDocumentProcessingJobs(organizationId, opts),
    serverQueryAiInsights(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <DocumentsClient
      initialDocuments={documents as Record<string, unknown>[]}
      initialArticles={articles as Record<string, unknown>[]}
      initialProcessingJobs={processingJobs as Record<string, unknown>[]}
      initialAiInsights={insights as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
