/**
 * Proxies SpacetimeDB HTTP calls under `/api/stdb/*` to the configured host.
 * Required for the browser SDK's `POST .../v1/identity/websocket-token` step when
 * using `sameOriginStdbProxy` (same-origin `ws(s)://host/api/stdb/` base URL).
 */

import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

function upstreamBase(): string {
  const raw =
    process.env['STDB_HOST'] ??
    process.env['NEXT_PUBLIC_STDB_HOST'] ??
    'https://maincloud.spacetimedb.com'
  return raw.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '')
}

async function proxyRequest(req: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const path = `/${pathSegments.join('/')}`
  const url = new URL(req.url)
  const target = `${upstreamBase()}${path}${url.search}`

  const store = await cookies()
  const cookieToken = store.get('stdb_token')?.value
  const authHeader = req.headers.get('authorization')
  let bearer: string | undefined
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    bearer = authHeader.slice(7).trim()
  }
  if (!bearer && cookieToken) bearer = cookieToken

  const headers = new Headers()
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  const contentType = req.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  const res = await fetch(target, init)
  const body = await res.arrayBuffer()
  const out = new NextResponse(body, { status: res.status })
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    out.headers.set(key, value)
  })
  return out
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
  const { path: segments = [] } = await ctx.params
  return proxyRequest(req, segments)
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
  const { path: segments = [] } = await ctx.params
  return proxyRequest(req, segments)
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  })
}
