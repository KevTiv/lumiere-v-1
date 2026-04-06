/**
 * CRM lead by id — proxied to Rust `api-server` `/v1/crm/leads/:id`.
 */

import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(
  request: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return forwardToApiServerRequired(request)
}

export async function PUT(
  request: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return forwardToApiServerRequired(request)
}

export async function DELETE(
  request: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return forwardToApiServerRequired(request)
}
