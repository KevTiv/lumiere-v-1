/**
 * Individual Lead API Routes — Phase 3 of API Gateway Refactor
 *
 * GET    /api/crm/leads/[id]  — Get a specific lead
 * PUT    /api/crm/leads/[id]  — Update a lead's details
 * DELETE /api/crm/leads/[id]  — Delete/archive a lead
 *
 * Authentication: Cookie (web) or Bearer token (Expo/mobile)
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import {
  serverQueryLeadById,
  type Lead,
} from '@lumiere/stdb/server'


interface UpdateLeadDetailsRequest {
  contactName?: string
  title?: string
  website?: string
  industry?: string
  referredBy?: string
  description?: string
}

interface UpdateLeadDetailsParams {
  contact_name: string | null
  title: string | null
  website: string | null
  industry: string | null
  referred_by: string | null
  description: string | null
}

interface UpdateLeadAddressRequest {
  street?: string
  city?: string
  zip?: string
  countryCode?: string
}

interface UpdateLeadAddressParams {
  street: string | null
  city: string | null
  zip: string | null
  country_code: string | null
}

interface UpdateLeadRevenueRequest {
  expectedRevenue?: number
  probability?: number
}

interface UpdateLeadRevenueParams {
  expected_revenue: number | null
  probability: number | null
}

interface ApiResponse<T> {
  data?: T
  error?: string
}

// Helper to check session
async function requireSession(req: NextRequest): Promise<ApiSession | null> {
  return resolveApiSession(req)
}

// Helper for error responses
function errorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json({ error: message } as ApiResponse<unknown>, { status })
}

// Helper to validate lead access
function validateLeadId(params: { id: string }): number {
  const leadId = parseInt(params.id, 10)
  if (Number.isNaN(leadId)) {
    throw new Error('Invalid lead ID')
  }
  return leadId
}

/**
 * GET /api/crm/leads/[id]
 * Get a specific lead by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { id } = await params

  try {
    const leadId = validateLeadId({ id })

    // Query specific lead from SpacetimeDB
    const lead = await serverQueryLeadById(leadId, session.organizationId, session.opts)

    if (!lead) {
      return errorResponse('Lead not found', 404)
    }

    return NextResponse.json({
      data: lead as Lead,
    } as ApiResponse<Lead>)
  } catch (error) {
    console.error('Failed to fetch lead:', error)
    return errorResponse('Failed to fetch lead', 500)
  }
}

/**
 * PUT /api/crm/leads/[id]
 * Update a lead's details
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  const b = body as Record<string, unknown>

  try {
    const leadId = validateLeadId({ id })

    // Determine which update operation to perform based on provided fields
    const hasDetails = b.contactName !== undefined || b.title !== undefined ||
      b.website !== undefined || b.industry !== undefined ||
      b.referredBy !== undefined || b.description !== undefined

    const hasAddress = b.street !== undefined || b.city !== undefined ||
      b.zip !== undefined || b.countryCode !== undefined

    const hasRevenue = b.expectedRevenue !== undefined || b.probability !== undefined

    // Build and execute update calls
    const updateCalls: Promise<void>[] = []

    if (hasDetails) {
      const params: UpdateLeadDetailsParams = {
        contact_name: typeof b.contactName === 'string' ? b.contactName : null,
        title: typeof b.title === 'string' ? b.title : null,
        website: typeof b.website === 'string' ? b.website : null,
        industry: typeof b.industry === 'string' ? b.industry : null,
        referred_by: typeof b.referredBy === 'string' ? b.referredBy : null,
        description: typeof b.description === 'string' ? b.description : null,
      }
      updateCalls.push(callReducer('update_lead_details', [leadId, params], session.opts))
    }

    if (hasAddress) {
      const params: UpdateLeadAddressParams = {
        street: typeof b.street === 'string' ? b.street : null,
        city: typeof b.city === 'string' ? b.city : null,
        zip: typeof b.zip === 'string' ? b.zip : null,
        country_code: typeof b.countryCode === 'string' ? b.countryCode : null,
      }
      updateCalls.push(callReducer('update_lead_address', [leadId, params], session.opts))
    }

    if (hasRevenue) {
      const params: UpdateLeadRevenueParams = {
        expected_revenue: typeof b.expectedRevenue === 'number' ? b.expectedRevenue : null,
        probability: typeof b.probability === 'number' ? b.probability : null,
      }
      updateCalls.push(callReducer('update_lead_revenue', [leadId, params], session.opts))
    }

    if (updateCalls.length === 0) {
      return errorResponse('No valid fields to update', 400)
    }

    // Execute all updates
    await Promise.all(updateCalls)

    return NextResponse.json({
      data: { message: 'Lead updated successfully' },
    } as ApiResponse<{ message: string }>)
  } catch (error) {
    console.error('Failed to update lead:', error)
    const message = error instanceof Error ? error.message : 'Failed to update lead'
    return errorResponse(message, 500)
  }
}

/**
 * DELETE /api/crm/leads/[id]
 * Delete/archive a lead
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { id } = await params

  try {
    const leadId = validateLeadId({ id })

    // Call the delete/archive lead reducer
    // Note: The actual reducer name may vary based on your SpacetimeDB module
    await callReducer('delete_lead', [leadId], session.opts)

    return NextResponse.json({
      data: { message: 'Lead deleted successfully' },
    } as ApiResponse<{ message: string }>)
  } catch (error) {
    console.error('Failed to delete lead:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete lead'
    return errorResponse(message, 500)
  }
}
