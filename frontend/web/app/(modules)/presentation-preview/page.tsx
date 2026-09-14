import { getStdbSession } from '@/lib/api-session'
import { PreviewComposer } from './preview-composer'

export default async function PresentationPreviewPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) return <p>An organization session is required.</p>
  return <PreviewComposer organizationId={session.organizationId} />
}
