import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const LIFETIME_MS = 10 * 60 * 1000
export const INVITE_COOKIE_MAX_AGE = LIFETIME_MS / 1000
const PURPOSE = Buffer.from('lumiere-workos-invite-v1')

export function hostedInviteCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Host-lumiere-invite'
    : 'lumiere-invite'
}

export function validInviteToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

function key(): Buffer {
  const password = process.env.WORKOS_COOKIE_PASSWORD
  if (!password || password.length < 32) throw new Error('WORKOS_COOKIE_PASSWORD is not configured')
  return createHash('sha256').update(password).update(PURPOSE).digest()
}

/** Authenticated encryption; only a short-lived opaque cookie crosses the provider redirect. */
export function sealHostedInvite(token: string, now = Date.now()): string {
  if (!validInviteToken(token)) throw new Error('Invalid invitation token')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(PURPOSE)
  const data = Buffer.concat([
    cipher.update(JSON.stringify({ token, exp: now + LIFETIME_MS }), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}

export function openHostedInvite(value: string | undefined, now = Date.now()): string | null {
  if (!value || value.length > 1024) return null
  try {
    const raw = Buffer.from(value, 'base64url')
    if (raw.length <= 28) return null
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
    decipher.setAAD(PURPOSE)
    decipher.setAuthTag(raw.subarray(12, 28))
    const payload = JSON.parse(Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString('utf8')) as { token?: unknown; exp?: unknown }
    if (!validInviteToken(payload.token) ||
        typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp <= now ||
        payload.exp > now + LIFETIME_MS) return null
    return payload.token
  } catch {
    return null
  }
}

export function hostedInviteCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  }
}
