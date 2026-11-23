/**
 * POST /api/ai/rag — retrieval-augmented answers scoped to an ERP company the user can access.
 */
import { type NextRequest } from 'next/server'

import { proxyRag } from './proxy'

export function POST(request: NextRequest) {
  return proxyRag(request, 'json')
}
