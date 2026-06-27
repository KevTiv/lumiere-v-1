import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryDocuments,
  serverQueryKnowledgeArticles,
  serverQueryKnowledgeCategories,
  serverQueryDocumentFolders,
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

  const [documents, articles, categories, folders, processingJobs, insights] = await Promise.all([
    serverQueryDocuments(organizationId, opts),
    serverQueryKnowledgeArticles(organizationId, opts),
    serverQueryKnowledgeCategories(organizationId, opts),
    serverQueryDocumentFolders(organizationId, opts),
    serverQueryAiDocumentProcessingJobs(organizationId, opts),
    serverQueryAiInsights(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], []])

  return (
    <DocumentsClient
      initialDocuments={documents as Record<string, unknown>[]}
      initialArticles={articles as Record<string, unknown>[]}
      initialCategories={categories as Record<string, unknown>[]}
      initialFolders={folders as Record<string, unknown>[]}
      initialProcessingJobs={processingJobs as Record<string, unknown>[]}
      initialAiInsights={insights as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
