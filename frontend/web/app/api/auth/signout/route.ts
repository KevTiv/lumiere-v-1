import { NextResponse } from 'next/server'
import { signOut } from '@workos-inc/authkit-nextjs'
import { clearStdbSession } from '@/app/actions/save-stdb-token'

export async function POST() {
  await clearStdbSession()
  if (!process.env.WORKOS_CLIENT_ID) {
    return NextResponse.json({ redirectTo: '/sign-in' })
  }
  await signOut({ returnTo: '/sign-in' })
}
