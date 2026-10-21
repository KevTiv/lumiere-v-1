import { type NextRequest } from 'next/server'
import { forwardToApiServerRequired } from '@/lib/api-server-forward'
export const GET = (request: NextRequest) => forwardToApiServerRequired(request)
export const POST = GET
export const PUT = GET
export const PATCH = GET
export const DELETE = GET
