/**
 * CRM Leads API Routes — Phase 3 of API Gateway Refactor
 *
 * GET  /api/crm/leads     — List all leads for the organization
 * POST /api/crm/leads     — Create a new lead
 *
 * Authentication: Cookie (web) or Bearer token (Expo/mobile)
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import {
  serverQueryLeads,
  type Lead,
  type CreateLeadParams,
  type StdbHttpOptions,
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

// Helper to check session
async function requireSession(req: NextRequest): Promise<ApiSession | null> {
  return resolveApiSession(req)
}

// Helper for error responses
function errorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json({ error: message } as ApiResponse<unknown>, { status })
}

/**
 * GET /api/crm/leads
 * Query params:
 *   - state: Filter by lead state (new, qualified, proposal, won, lost)
 *   - userId: Filter by assigned user
 *   - priority: Filter by priority (low, medium, high)
 *   - limit: Max results (default 50)
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
  const state = searchParams.get('state')
  const userId = searchParams.get('userId')
  const priority = searchParams.get('priority')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  try {
    // Query leads from SpacetimeDB
    const leads = await serverQueryLeads(session.organizationId, session.opts)

    // Filter results (server-side filtering based on query params)
    let filteredLeads = leads as Lead[]

    if (state) {
      filteredLeads = filteredLeads.filter(l => l.state === state)
    }

    if (userId) {
      const userIdNum = parseInt(userId, 10)
      filteredLeads = filteredLeads.filter(l => l.userId === userIdNum)
    }

    if (priority) {
      filteredLeads = filteredLeads.filter(l => l.priority === priority)
    }

    // Apply pagination
    const total = filteredLeads.length
    const paginatedLeads = filteredLeads.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginatedLeads,
      meta: {
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
      },
    } as ApiResponse<Lead[]>)
  } catch (error) {
    console.error('Failed to fetch leads:', error)
    return errorResponse('Failed to fetch leads', 500)
  }
}

/**
 * POST /api/crm/leads
 * Create a new lead using the create_lead reducer
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  let body: Partial<CreateLeadParams>
  try {
    body = (await request.json()) as Partial<CreateLeadParams>
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  // Validate required fields
  if (!body.name || typeof body.name !== 'string') {
    return errorResponse('Name is required', 400)
  }

  try {
    // Build params for SpacetimeDB reducer
    const params: CreateLeadParams = {
      name: body.name,
      priority: body.priority ?? 'medium',
      state: body.state ?? 'new',
      expectedRevenue: body.expectedRevenue ?? 0,
      probability: body.probability ?? 0,
      tagIds: body.tagIds ?? [],
      email: body.email ?? null,
      phone: body.phone ?? null,
      mobile: body.mobile ?? null,
      companyName: body.companyName ?? null,
      contactName: body.contactName ?? null,
      title: body.title ?? null,
      street: body.street ?? null,
      city: body.city ?? null,
      zip: body.zip ?? null,
      countryCode: body.countryCode ?? null,
      website: body.website ?? null,
      industry: body.industry ?? null,
      sourceId: body.sourceId ?? null,
      campaignId: body.campaignId ?? null,
      mediumId: body.mediumId ?? null,
      referredBy: body.referredBy ?? null,
      description: body.description ?? null,
      userId: body.userId ?? null,
      teamId: body.teamId ?? null,
      partnerId: body.partnerId ?? null,
      dateDeadline: body.dateDeadline ?? null,
      metadata: body.metadata ?? null,
    }

    // Call the create_lead reducer
    await callReducer('create_lead', [session.organizationId, params], session.opts)

    // Return success (SpacetimeDB reducers don't return the created row)
    return NextResponse.json({
      data: { message: 'Lead created successfully' },
    } as ApiResponse<{ message: string }>, { status: 201 })
  } catch (error) {
    console.error('Failed to create lead:', error)
    const message = error instanceof Error ? error.message : 'Failed to create lead'
    return errorResponse(message, 500)
  }
}
