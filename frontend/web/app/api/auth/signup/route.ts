import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'
import { captureServerEvent } from '@/lib/posthog-server'

export async function POST(req: NextRequest) {
  const res = await forwardToApiServerRequired(req)

  if (res.status >= 200 && res.status < 300) {
    await captureServerEvent({
      distinctId: 'server',
      event: 'api_user_signed_up',
      properties: { source: 'api' },
    })
  }

  return res
}
