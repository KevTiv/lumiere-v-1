import { MissingOrganization } from "@lumiere/ui"
import { getStdbSession } from '@/lib/api-session'
import { PreviewComposer } from './preview-composer'

export default async function PresentationPreviewPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) return <MissingOrganization />
  return <PreviewComposer organizationId={session.organizationId} />
}
