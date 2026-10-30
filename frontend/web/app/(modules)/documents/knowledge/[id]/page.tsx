import { AssistantGuidePageClient } from "./guide-page-client"

export default async function AssistantGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AssistantGuidePageClient guideId={id} />
}
