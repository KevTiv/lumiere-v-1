import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  findCredentialByEmail,
  verifyPassword,
  decryptToken,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = schema.parse(body)

    // Look up credential
    const cred = await findCredentialByEmail(email)
    if (!cred) {
      // Return same error for both "not found" and "wrong password" to prevent enumeration
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Verify password
    const valid = await verifyPassword(password, cred.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Decrypt stored token and establish session
    const token = await decryptToken(cred.stdb_token_enc)
    await saveStdbSession(token, cred.identity)

    return NextResponse.json({ redirectTo: '/overview' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/signin]', err)
    return NextResponse.json({ error: 'Sign in failed' }, { status: 500 })
  }
}
