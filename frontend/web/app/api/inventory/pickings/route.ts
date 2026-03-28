/**
 * Inventory Stock Pickings API Route — Phase 4 of API Gateway Refactor
 *
 * GET  /api/inventory/pickings  — List stock pickings for the organization
 */

import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiSession, type ApiSession } from '@/lib/api-session'
import { callReducer } from '@/lib/stdb-reducer'
import { serverQueryStockPickings } from '@lumiere/stdb/server'

interface ApiResponse<T> {
  data?: T
  error?: string
}

async function requireSession(req: NextRequest): Promise<ApiSession | null> {
  return resolveApiSession(req)
}

function errorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json({ error: message } as ApiResponse<unknown>, { status })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) return errorResponse('Unauthorized', 401)
  if (!session.organizationId) return errorResponse('No organization assigned', 403)

  try {
    const data = await serverQueryStockPickings(session.organizationId, session.opts)
    return NextResponse.json({ data })
  } catch (error) {
    console.error('Failed to fetch stock pickings:', error)
    return errorResponse('Failed to fetch stock pickings', 500)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) return errorResponse('Unauthorized', 401)
  if (!session.organizationId) return errorResponse('No organization assigned', 403)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  try {
    await callReducer('create_stock_picking', [session.organizationId, body], session.opts)
    return NextResponse.json({ data: { message: 'Stock picking created successfully' } }, { status: 201 })
  } catch (error) {
    console.error('Failed to create stock picking:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to create stock picking', 500)
  }
}
