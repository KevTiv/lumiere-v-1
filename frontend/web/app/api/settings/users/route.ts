/**
 * Settings — Users API Routes — Phase 3 of API Gateway Refactor
 *
 * GET  /api/settings/users — List all users in the organization
 *
 * Scoping: organizationId only — never exposes companyId to clients.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession } from '@/lib/api-session'
import {
  serverQueryOrgUsers,
  serverQueryUserRoleAssignments,
} from '@lumiere/stdb/server'

interface ApiResponse<T> {
  data?: T
  error?: string
  meta?: { total?: number; page?: number; limit?: number }
}

function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message } as ApiResponse<unknown>, { status })
}

/**
 * GET /api/settings/users
 * Lists all active users in the organization with their profiles.
 * Query params: limit, offset, search (by name/email)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await resolveApiSession(request)
  if (!session) return errorResponse('Unauthorized', 401)
  if (!session.organizationId) return errorResponse('No organization assigned', 403)

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  try {
    let users = await serverQueryOrgUsers(session.organizationId, session.opts)

    if (search) {
      const q = search.toLowerCase()
      users = users.filter((u: Record<string, unknown>) => {
        const name = String(u.name ?? u.username ?? '').toLowerCase()
        const email = String(u.email ?? '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
    }

    const total = users.length
    const page = users.slice(offset, offset + limit)

    return NextResponse.json({
      data: page,
      meta: { total, page: Math.floor(offset / limit) + 1, limit },
    } as ApiResponse<unknown[]>)
  } catch (error) {
    console.error('Failed to fetch org users:', error)
    return errorResponse('Failed to fetch users', 500)
  }
}
