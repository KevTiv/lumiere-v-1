import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  findInviteByTokenHash,
  generateSecureToken,
  provisionStdbIdentity,
  hashPassword,
  encryptToken,
  callStdbReducer,
  findCredentialByEmail,
  microsToDate,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'

const schema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, email, password } = schema.parse(body)

    // Hash the token to look it up
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const tokenHash = Buffer.from(hashBuffer).toString('hex')

    // Find and validate invite
    const invite = await findInviteByTokenHash(tokenHash)
    if (!invite) {
      return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
    }
    if (invite.accepted_at !== null) {
      return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 })
    }
    if (microsToDate(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 })
    }
    // Verify email matches invite
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'Email does not match invitation' }, { status: 400 })
    }

    // Check if this email already has an account (user is signing in to accept)
    let stdbIdentity: string
    let stdbToken: string

    const existing = await findCredentialByEmail(email)
    if (existing) {
      // Existing user — just add them to the org
      stdbIdentity = existing.identity
      const { decryptToken } = await import('@/lib/stdb-auth-server')
      stdbToken = await decryptToken(existing.stdb_token_enc)
    } else {
      // New user — provision identity and store credentials
      const provisioned = await provisionStdbIdentity()
      stdbIdentity = provisioned.identity
      stdbToken = provisioned.token

      const [passwordHash, tokenEnc] = await Promise.all([
        hashPassword(password),
        encryptToken(stdbToken),
      ])

      await callStdbReducer('store_user_credential', [
        stdbIdentity,
        email,
        passwordHash,
        tokenEnc,
      ])
    }

    // Add user to org with the invited role
    await callStdbReducer('add_org_member', [
      stdbIdentity,
      invite.organization_id,
      {
        role_name: String(invite.role_id), // role_id stored in invite; reducer resolves by name
        company_id: null,
        job_title: null,
        department_id: null,
        employee_id: null,
        is_active: true,
        is_default: true,
        metadata: null,
      },
    ])

    // Mark invite as accepted
    await callStdbReducer('mark_invite_accepted', [invite.id])

    // Set session
    await saveStdbSession(stdbToken, stdbIdentity)

    return NextResponse.json({ redirectTo: '/overview' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/accept-invite]', err)
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 })
  }
}
