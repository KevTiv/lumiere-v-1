import type { NextRequest } from 'next/server'
import { proxyRag } from '../proxy'

export function POST(request: NextRequest) {
  return proxyRag(request, 'sse')
}
