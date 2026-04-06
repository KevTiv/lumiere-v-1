import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'

export async function POST(req: NextRequest) {
  return forwardToApiServerRequired(req)
}
