/**
 * GET /api/stdb/subscription-queries?resource=...
 *
 * Returns SpacetimeDB subscription SQL for one resource key (see SUBSCRIPTION_RESOURCE_KEYS).
 * Use `resource=all` for the explicit full mirror (auth + all org ERP tables via FULL_CLIENT_SUBSCRIPTION_RESOURCES).
 * The live WebSocket connects to /api/stdb (custom server.js proxy), not this route.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession } from '@/lib/api-session'
import {
  createClientSubscriptions,
  subscriptionQueriesForResource,
  SUBSCRIPTION_RESOURCE_KEYS,
  FULL_CLIENT_SUBSCRIPTION_RESOURCES,
} from '@lumiere/stdb'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resource = request.nextUrl.searchParams.get('resource')?.trim()
  if (!resource) {
    return NextResponse.json(
      {
        error: 'Missing query param: resource',
        available: [...SUBSCRIPTION_RESOURCE_KEYS, 'all'],
      },
      { status: 400 },
    )
  }

  const identityHex =
    session.identityHex !== 'unknown' ? session.identityHex : undefined

  if (resource === 'all') {
    const queries = createClientSubscriptions(FULL_CLIENT_SUBSCRIPTION_RESOURCES, {
      organizationId: session.organizationId,
      identityHex,
    })
    return NextResponse.json({
      resource: 'all',
      organizationId: session.organizationId ?? null,
      queries,
    })
  }

  const queries = subscriptionQueriesForResource(resource, {
    organizationId: session.organizationId,
    identityHex,
  })

  if (queries === null) {
    return NextResponse.json(
      {
        error: 'Unknown resource, or missing context (e.g. organizationId for ERP tables, identity for user-roles)',
        resource,
        available: [...SUBSCRIPTION_RESOURCE_KEYS, 'all'],
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    resource,
    organizationId: session.organizationId ?? null,
    queries,
  })
}
