import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

type AuthRateKind =
  | 'signin'
  | 'signup'
  | 'forgot_password'
  | 'reset_password'
  | 'accept_invite'
  | 'invite'

type WindowSpec = { limit: number; windowMs: number }

const DEFAULTS: Record<AuthRateKind, WindowSpec> = {
  signin: { limit: 30, windowMs: 15 * 60 * 1000 },
  signup: { limit: 10, windowMs: 60 * 60 * 1000 },
  forgot_password: { limit: 5, windowMs: 60 * 60 * 1000 },
  reset_password: { limit: 20, windowMs: 60 * 60 * 1000 },
  accept_invite: { limit: 20, windowMs: 60 * 60 * 1000 },
  invite: { limit: 40, windowMs: 60 * 60 * 1000 },
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const PRUNE_EVERY = 200
let opsSincePrune = 0

function pruneExpired(now: number): void {
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k)
  }
}

function takeToken(key: string, spec: WindowSpec, now: number): boolean {
  opsSincePrune++
  if (opsSincePrune >= PRUNE_EVERY) {
    opsSincePrune = 0
    pruneExpired(now)
  }

  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + spec.windowMs })
    return true
  }
  if (b.count >= spec.limit) return false
  b.count++
  return true
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}

/**
 * Fixed-window rate limit for auth API routes. In-memory (per Node process).
 * For multi-instance production, consider Redis / edge rate limiting.
 */
export function authRateLimitExceeded(
  req: NextRequest,
  kind: AuthRateKind,
): NextResponse | null {
  if (process.env['AUTH_RATE_LIMIT_DISABLED'] === 'true') {
    return null
  }

  const spec = DEFAULTS[kind]
  const ip = clientIp(req)
  const key = `${kind}:${ip}`
  const now = Date.now()

  if (takeToken(key, spec, now)) {
    return null
  }

  const b = buckets.get(key)
  const retryAfterSec = b
    ? Math.max(1, Math.ceil((b.resetAt - now) / 1000))
    : Math.max(1, Math.ceil(spec.windowMs / 1000))

  return NextResponse.json(
    { error: 'Too many requests. Try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
      },
    },
  )
}
