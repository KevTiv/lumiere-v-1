import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function GET(req: NextRequest) {
  return forwardToApiServerRequired(req)
}

export async function PATCH(req: NextRequest) {
  return forwardToApiServerRequired(req)
}
