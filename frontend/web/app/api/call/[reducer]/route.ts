/**
 * Generic SpacetimeDB Reducer Passthrough
 *
 * POST /api/call/:reducer[?withCompany=true]
 *
 * Authenticates the request and proxies the call to any SpacetimeDB reducer.
 * Body: JSON array of arguments to pass directly to the reducer.
 *
 * ?withCompany=true — resolves companyId server-side and prepends
 *   [orgId, companyId] before your args. Use for reducers that require
 *   both organizationId and companyId as their first two parameters.
 *
 * Examples:
 *   POST /api/call/create_lead
 *   Body: [1, { "name": "Acme Corp" }]
 *
 *   POST /api/call/create_account_account?withCompany=true
 *   Body: [{ "name": "Cash", "code": "1000" }]
 *   → calls reducer with [orgId, companyId, { name, code }]
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import { resolveCompanyIds } from '@lumiere/stdb/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reducer: string }> },
): Promise<NextResponse> {
  const session = await resolveApiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.organizationId) {
    return NextResponse.json({ error: 'No organization assigned' }, { status: 403 })
  }

  const { reducer } = await params
  const withCompany = new URL(request.url).searchParams.get('withCompany') === 'true'

  let args: unknown[]
  try {
    const body = await request.json()
    args = Array.isArray(body) ? body : [body]
  } catch {
    return NextResponse.json({ error: 'Invalid request body — expected JSON array of args' }, { status: 400 })
  }

  if (withCompany) {
    const [companyId] = await resolveCompanyIds(session.organizationId, session.opts)
    if (!companyId) {
      return NextResponse.json({ error: 'No company found for organization' }, { status: 422 })
    }
    args = [session.organizationId, companyId, ...args]
  }

  try {
    await callReducer(reducer, args, session.opts)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reducer call failed'
    console.error(`[/api/call/${reducer}]`, error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
