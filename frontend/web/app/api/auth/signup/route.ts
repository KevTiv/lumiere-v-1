import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  provisionStdbIdentity,
  hashPassword,
  encryptToken,
  callStdbReducer,
  findCredentialByEmail,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'
import { sendWelcomeEmail } from '@/lib/email'
import { postAuthDestinationAfterSession } from '@/lib/post-auth-destination'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: NextRequest) {
  try {
    if (process.env.WORKOS_CLIENT_ID) {
      return NextResponse.json(
        {
          error:
            'Password sign-up is disabled. Use the WorkOS sign-up page (Continue with WorkOS).',
        },
        { status: 410 },
      )
    }

    const body = await req.json()
    const { email, password } = schema.parse(body)

    // Check email not already taken
    const existing = await findCredentialByEmail(email)
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }

    // Provision new SpacetimeDB identity server-side
    const { identity, token } = await provisionStdbIdentity()

    // Hash password and encrypt token (in parallel)
    const [passwordHash, tokenEnc] = await Promise.all([
      hashPassword(password),
      encryptToken(token),
    ])

    // Store credential in private SpacetimeDB table via admin reducer call
    await callStdbReducer('store_user_credential', [
      identity,
      email,
      passwordHash,
      tokenEnc,
    ])

    // Set HTTP-only session cookies
    await saveStdbSession(token, identity)

    // Send welcome email (best-effort)
    sendWelcomeEmail(email).catch((e) => console.warn('[signup] welcome email failed', e))

    return NextResponse.json({ redirectTo: postAuthDestinationAfterSession({ hasOrganization: false }) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/signup]', err)
    return NextResponse.json({ error: 'Sign up failed' }, { status: 500 })
  }
}
