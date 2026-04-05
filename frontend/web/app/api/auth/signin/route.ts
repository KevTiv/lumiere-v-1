import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  findCredentialByEmail,
  verifyPassword,
  decryptToken,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'
import { postAuthDestinationAfterSession } from '@/lib/post-auth-destination'
import { normalizeIdentityHexForSql } from '@/lib/stdb-http-env'
import { serverQueryUserOrganizationWithFallback } from '@/lib/stdb-org-resolve'
import { authRateLimitExceeded } from '@/lib/auth-rate-limit'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const limited = authRateLimitExceeded(req, 'signin')
    if (limited) return limited

    if (process.env.WORKOS_CLIENT_ID) {
      return NextResponse.json(
        {
          error:
            'Password sign-in is disabled. Use the WorkOS sign-in page (Continue with WorkOS).',
        },
        { status: 410 },
      )
    }

    const body = await req.json()
    const { email, password } = schema.parse(body)

    // Look up credential
    const cred = await findCredentialByEmail(email)
    if (!cred) {
      // Return same error for both "not found" and "wrong password" to prevent enumeration
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    if (!cred.password_hash) {
      return NextResponse.json(
        { error: 'This account uses SSO. Sign in with SSO instead.' },
        { status: 401 },
      )
    }

    // Verify password
    const valid = await verifyPassword(password, cred.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Decrypt stored token and establish session
    const token = await decryptToken(cred.stdb_token_enc)
    const identityHex = normalizeIdentityHexForSql(String(cred.identity))
    await saveStdbSession(token, identityHex)

    let hasOrganization = false
    try {
      const orgs = await serverQueryUserOrganizationWithFallback(identityHex, { token })
      hasOrganization = Array.isArray(orgs) && orgs.length > 0
    } catch {
      hasOrganization = false
    }

    return NextResponse.json({
      redirectTo: postAuthDestinationAfterSession({ hasOrganization }),
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/signin]', err)
    return NextResponse.json({ error: 'Sign in failed' }, { status: 500 })
  }
}
