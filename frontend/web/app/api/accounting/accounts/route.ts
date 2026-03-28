/**
 * Accounting Accounts API Route — Phase 3 of API Gateway Refactor
 *
 * GET  /api/accounting/accounts  — List chart of accounts for the organization
 *
 * Authentication: Cookie (web) or Bearer token (Expo/mobile)
 *
 * Notes:
 * - GET uses `organization_id` SQL scope; POST calls `create_account_account` with optional `company_id` in body (default resolved in reducer).
 * - `code` filter: prefix match on the account code (e.g. "1000")
 * - `search` filter: substring match on name or code
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import {
  serverQueryAccountAccounts,
  type AccountAccount,
  type CreateAccountAccountParams,
} from '@lumiere/stdb/server'

interface ApiResponse<T> {
  data?: T
  error?: string
  meta?: {
    total?: number
    page?: number
    limit?: number
  }
}

async function requireSession(req: NextRequest): Promise<ApiSession | null> {
  return resolveApiSession(req)
}

function errorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json({ error: message } as ApiResponse<unknown>, { status })
}

/**
 * GET /api/accounting/accounts
 * Query params:
 *   - code: Filter by account code prefix (e.g. "1000", "2")
 *   - search: Substring match across code and name fields
 *   - limit: Max results (default 50, max 100)
 *   - offset: Pagination offset
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const search = searchParams.get('search')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  try {
    const accounts = await serverQueryAccountAccounts(session.organizationId, session.opts)

    let filtered = accounts as AccountAccount[]

    if (code) {
      filtered = filtered.filter(a => a.code.startsWith(code))
    }

    if (search) {
      const term = search.toLowerCase()
      filtered = filtered.filter(
        a =>
          a.code.toLowerCase().includes(term) ||
          a.name.toLowerCase().includes(term),
      )
    }

    const total = filtered.length
    const paginated = filtered.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginated,
      meta: {
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
      },
    } as ApiResponse<AccountAccount[]>)
  } catch (error) {
    console.error('Failed to fetch accounts:', error)
    return errorResponse('Failed to fetch accounts', 500)
  }
}

/**
 * POST /api/accounting/accounts
 * Create a new chart-of-accounts entry via the create_account_account reducer.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) return errorResponse('Unauthorized', 401)
  if (!session.organizationId) return errorResponse('No organization assigned', 403)

  let body: Partial<CreateAccountAccountParams>
  try {
    body = (await request.json()) as Partial<CreateAccountAccountParams>
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  if (!body.name || typeof body.name !== 'string') {
    return errorResponse('Name is required', 400)
  }

  try {
    await callReducer('create_account_account', [session.organizationId, body], session.opts)
    return NextResponse.json({ data: { message: 'Account created successfully' } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create account:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create account', 500)
  }
}
