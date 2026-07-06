import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { DocumentsClient } from "./documents-client"

const SSR_RESOURCES = [
  "documents",
  "knowledge-articles",
  "knowledge-categories",
  "document-folders",
  "ai-document-processing-jobs",
  "ai-insights",
] as const

export default async function DocumentsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <DocumentsClient />
  }

  const [documents, articles, categories, folders, processingJobs, insights] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <DocumentsClient
      initialDocuments={documents}
      initialArticles={articles}
      initialCategories={categories}
      initialFolders={folders}
      initialProcessingJobs={processingJobs}
      initialAiInsights={insights}
      organizationId={session.organizationId}
    />
  )
}
