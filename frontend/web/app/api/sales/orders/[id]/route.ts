/**
 * Sales Order Detail API Routes — Phase 3 of API Gateway Refactor
 *
 * GET    /api/sales/orders/[id] — Fetch a single sale order by ID
 * PUT    /api/sales/orders/[id] — Update a sale order (not implemented — no update reducer)
 * DELETE /api/sales/orders/[id] — Cancel a sale order
 *
 * Authentication: Cookie (web) or Bearer token (Expo/mobile)
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import {
  serverQuerySaleOrders,
  type SaleOrder,
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

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/sales/orders/[id]
 * Fetch a single sale order by ID.
 * Filters the full result set in memory — sale_order has no org-scoped single-row query.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { id } = await context.params
  const orderId = parseInt(id, 10)
  if (Number.isNaN(orderId)) {
    return errorResponse('Invalid order ID', 400)
  }

  try {
    const orders = await serverQuerySaleOrders(session.organizationId, session.opts)
    const order = (orders as SaleOrder[]).find(o => BigInt(o.id) === BigInt(orderId)) ?? null

    if (!order) {
      return errorResponse('Sale order not found', 404)
    }

    return NextResponse.json({ data: order } as ApiResponse<SaleOrder>)
  } catch (error) {
    console.error('Failed to fetch sale order:', error)
    return errorResponse('Failed to fetch sale order', 500)
  }
}

/**
 * PUT /api/sales/orders/[id]
 * Update a sale order.
 *
 * TODO: No update_sale_order reducer exists in the generated bindings.
 * Implement this endpoint once the backend reducer is added.
 */
export async function PUT(
  _request: NextRequest,
  _context: RouteContext,
): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'update_sale_order reducer not yet implemented on the backend' } as ApiResponse<unknown>,
    { status: 501 },
  )
}

/**
 * DELETE /api/sales/orders/[id]
 * Cancel a sale order using the cancel_sale_order reducer.
 * Accepts optional `reason` in the JSON body.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return errorResponse('Unauthorized', 401)
  }

  if (!session.organizationId) {
    return errorResponse('No organization assigned', 403)
  }

  const { id } = await context.params
  const orderId = parseInt(id, 10)
  if (Number.isNaN(orderId)) {
    return errorResponse('Invalid order ID', 400)
  }

  // Optional cancellation reason from body
  let reason: string | null = null
  try {
    const body = await request.json() as { reason?: string }
    reason = body.reason ?? null
  } catch {
    // Body is optional — proceed without a reason
  }

  try {
    // cancel_sale_order reducer signature: (organizationId, orderId, reason)
    await callReducer(
      'cancel_sale_order',
      [session.organizationId, orderId, reason],
      session.opts,
    )

    return NextResponse.json({
      data: { message: 'Sale order cancelled successfully' },
    } as ApiResponse<{ message: string }>)
  } catch (error) {
    console.error('Failed to cancel sale order:', error)
    const message = error instanceof Error ? error.message : 'Failed to cancel sale order'
    return errorResponse(message, 500)
  }
}
