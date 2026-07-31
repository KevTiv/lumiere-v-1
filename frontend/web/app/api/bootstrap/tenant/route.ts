/**
 * POST /api/bootstrap/tenant — proxied to Rust `api-server` `/v1/bootstrap/tenant`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'
import { captureServerEvent } from '@/lib/posthog-server'

export async function POST(request: NextRequest) {
  let orgName: string | undefined
  let currencyId: number | undefined
  try {
    const body = await request.clone().json()
    orgName = typeof body?.organization?.name === 'string' ? body.organization.name : undefined
    currencyId = typeof body?.defaultCompanyCurrencyId === 'number' ? body.defaultCompanyCurrencyId : undefined
  } catch {
    // ignore parse errors
  }

  const res = await forwardToApiServerRequired(request)

  if (res.status >= 200 && res.status < 300) {
    await captureServerEvent({
      distinctId: 'server',
      event: 'api_tenant_bootstrapped',
      properties: { source: 'api', organization_name: orgName, currency_id: currencyId },
    })
  }

  return res
}
