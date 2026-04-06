/**
 * Sale order by id — proxied to Rust `api-server` `/v1/sales/orders/:id`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, _ctx: Ctx) {
  return forwardToApiServerRequired(request)
}

export async function PUT(request: NextRequest, _ctx: Ctx) {
  return forwardToApiServerRequired(request)
}

export async function DELETE(request: NextRequest, _ctx: Ctx) {
  return forwardToApiServerRequired(request)
}
