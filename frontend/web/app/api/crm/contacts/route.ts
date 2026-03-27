/**
 * CRM Contacts API Routes
 *
 * Phase 3 of API Gateway Refactor
 * GET  /api/crm/contacts — List all contacts for the organization
 * POST /api/crm/contacts — Create a new contact
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import {
  serverQueryContacts,
  type Contact,
  type CreateContactParams,
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
 * GET /api/crm/contacts
 * Query params:
 *   - type: Filter by contact type (person, company)
 *   - isCustomer: Filter by customer flag
 *   - isVendor: Filter by vendor flag
 *   - search: Search by name or email
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
  const type = searchParams.get('type')
  const isCustomer = searchParams.get('isCustomer')
  const isVendor = searchParams.get('isVendor')
  const isProspect = searchParams.get('isProspect')
  const search = searchParams.get('search')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  try {
    // Query contacts from SpacetimeDB
    const contacts = await serverQueryContacts(session.organizationId, session.opts)

    // Filter results
    let filteredContacts = contacts as Contact[]

    if (type) {
      filteredContacts = filteredContacts.filter(c => c.type === type)
    }

    if (isCustomer !== null) {
      const isCustomerBool = isCustomer === 'true'
      filteredContacts = filteredContacts.filter(c => c.isCustomer === isCustomerBool)
    }

    if (isVendor !== null) {
      const isVendorBool = isVendor === 'true'
      filteredContacts = filteredContacts.filter(c => c.isVendor === isVendorBool)
    }

    if (isProspect !== null) {
      const isProspectBool = isProspect === 'true'
      filteredContacts = filteredContacts.filter(c => c.isProspect === isProspectBool)
    }

    if (search) {
      const searchLower = search.toLowerCase()
      filteredContacts = filteredContacts.filter(c =>
        c.name.toLowerCase().includes(searchLower) ||
        c.email?.toLowerCase().includes(searchLower) ||
        c.displayName?.toLowerCase().includes(searchLower)
      )
    }

    // Apply pagination
    const total = filteredContacts.length
    const paginatedContacts = filteredContacts.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginatedContacts,
      meta: {
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
      },
    } as ApiResponse<Contact[]>)
  } catch (error) {
    console.error('Failed to fetch contacts:', error)
    return errorResponse('Failed to fetch contacts', 500)
  }
}

/**
 * POST /api/crm/contacts
 * Create a new contact using the create_contact reducer
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  let body: Partial<CreateContactParams>
  try {
    body = (await request.json()) as Partial<CreateContactParams>
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  // Validate required fields
  if (!body.name || typeof body.name !== 'string') {
    return errorResponse('Name is required', 400)
  }

  try {
    // Build params — generated types are camelCase, matching the JSON body directly
    const params: CreateContactParams = {
      name: body.name,
      type: body.type ?? 'person',
      email: body.email ?? null,
      phone: body.phone ?? null,
      mobile: body.mobile ?? null,
      companyId: body.companyId ?? null,
      isCustomer: body.isCustomer ?? false,
      isVendor: body.isVendor ?? false,
      isEmployee: body.isEmployee ?? false,
      isProspect: body.isProspect ?? false,
      isPartner: body.isPartner ?? false,
      customerRank: body.customerRank ?? 0,
      supplierRank: body.supplierRank ?? 0,
      displayName: body.displayName ?? null,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      title: body.title ?? null,
      emailSecondary: body.emailSecondary ?? null,
      fax: body.fax ?? null,
      website: body.website ?? null,
      street: body.street ?? null,
      street2: body.street2 ?? null,
      city: body.city ?? null,
      stateCode: body.stateCode ?? null,
      zip: body.zip ?? null,
      countryCode: body.countryCode ?? null,
      taxId: body.taxId ?? null,
      companyRegistry: body.companyRegistry ?? null,
      industry: body.industry ?? null,
      employeesCount: body.employeesCount ?? null,
      annualRevenue: body.annualRevenue ?? null,
      description: body.description ?? null,
      salespersonId: body.salespersonId ?? null,
      assignedUserId: body.assignedUserId ?? null,
      parentId: body.parentId ?? null,
      userId: body.userId ?? null,
      color: body.color ?? null,
      metadata: body.metadata ?? null,
    }

    // Call the create_contact reducer
    await callReducer('create_contact', [session.organizationId, params], session.opts)

    // Return success (SpacetimeDB reducers don't return the created row)
    return NextResponse.json({
      data: { message: 'Contact created successfully' },
    } as ApiResponse<{ message: string }>, { status: 201 })
  } catch (error) {
    console.error('Failed to create contact:', error)
    const message = error instanceof Error ? error.message : 'Failed to create contact'
    return errorResponse(message, 500)
  }
}
