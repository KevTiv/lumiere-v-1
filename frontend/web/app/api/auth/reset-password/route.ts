import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  findResetTokenByHash,
  findCredentialByIdentity,
  hashPassword,
  callStdbReducer,
  decryptToken,
  microsToDate,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, newPassword } = schema.parse(body)

    // Hash token for lookup
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const tokenHash = Buffer.from(hashBuffer).toString('hex')

    // Find and validate reset token
    const resetToken = await findResetTokenByHash(tokenHash)
    if (!resetToken) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
    }
    if (resetToken.used_at !== null) {
      return NextResponse.json({ error: 'Reset link has already been used' }, { status: 400 })
    }
    if (microsToDate(resetToken.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Reset link has expired' }, { status: 400 })
    }

    // Hash new password
    const newHash = await hashPassword(newPassword)

    // Update password in credential table
    await callStdbReducer('update_user_password', [resetToken.identity, newHash])

    // Mark token as used
    await callStdbReducer('mark_reset_token_used', [resetToken.id])

    // Retrieve credential to re-establish session
    const cred = await findCredentialByIdentity(resetToken.identity)
    if (cred) {
      const rawToken = await decryptToken(cred.stdb_token_enc)
      await saveStdbSession(rawToken, cred.identity)
    }

    return NextResponse.json({ redirectTo: '/overview' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/reset-password]', err)
    return NextResponse.json({ error: 'Password reset failed' }, { status: 500 })
  }
}
