/**
 * Settings — Roles API Routes — Phase 3 of API Gateway Refactor
 *
 * GET  /api/settings/roles     — List all active roles (global, not org-scoped)
 *
 * Authentication: Cookie (web) or Bearer token (Expo/mobile)
 *
 * Scoping: Roles are global system entities — they are NOT scoped by organizationId.
 * Any authenticated user can read the roles list. The organizationId check is
 * retained to ensure the caller is a provisioned org member before serving data.
 *
 * POST is intentionally omitted — role creation is an admin-only operation
 * managed outside of the self-service API gateway.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import {
  serverQueryRoles,
  type Role,
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
 * GET /api/settings/roles
 * Returns all active roles in the system.
 * Roles are global — no organizationId filter is applied.
 *
 * Query params:
 *   - limit:   Max results (default 50, capped at 100)
 *   - offset:  Pagination offset
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  try {
    // serverQueryRoles takes only opts — roles are global, not org-scoped
    const roles = await serverQueryRoles(session.opts)

    const allRoles = roles as Role[]
    const total = allRoles.length
    const paginated = allRoles.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginated,
      meta: {
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
      },
    } as ApiResponse<Role[]>)
  } catch (error) {
    console.error('Failed to fetch roles:', error)
    return errorResponse('Failed to fetch roles', 500)
  }
}
