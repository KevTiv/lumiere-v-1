import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  findCredentialByEmail,
  callStdbReducer,
  generateSecureToken,
  nowMicros,
} from '@/lib/stdb-auth-server'
import { sendPasswordResetEmail } from '@/lib/email'

const schema = z.object({
  email: z.string().email(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = schema.parse(body)

    // Always return 200 to prevent email enumeration
    const cred = await findCredentialByEmail(email)
    if (cred) {
      const { token, tokenHash } = await generateSecureToken()
      // 1 hour expiry in microseconds
      const expiresAt = nowMicros() + BigInt(60 * 60 * 1000 * 1000)

      await callStdbReducer('create_password_reset_token', [
        cred.identity,
        tokenHash,
        expiresAt.toString(),
      ])

      sendPasswordResetEmail(email, token).catch((e) =>
        console.warn('[forgot-password] email failed', e)
      )
    }

    return NextResponse.json({ message: 'If that email exists, a reset link has been sent.' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }
    console.error('[auth/forgot-password]', err)
    // Still return 200 to prevent enumeration
    return NextResponse.json({ message: 'If that email exists, a reset link has been sent.' })
  }
}
