import { NextResponse } from 'next/server'
import { clearStdbSession } from '@/app/actions/save-stdb-token'

export async function POST() {
  await clearStdbSession()
  return NextResponse.json({ redirectTo: '/sign-in' })
}
