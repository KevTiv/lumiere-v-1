import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import {
  callStdbReducer,
  generateSecureToken,
  queryStdb,
  nowMicros,
} from '@/lib/stdb-auth-server'
import { sendInviteEmail } from '@/lib/email'
import { authRateLimitExceeded } from '@/lib/auth-rate-limit'

const schema = z.object({
  email: z.string().email(),
  roleId: z.number().int().positive(),
  organizationId: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  try {
    const limited = authRateLimitExceeded(req, 'invite')
    if (limited) return limited

    const store = await cookies()
    const identityHex = store.get('stdb_identity')?.value
    if (!identityHex) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { email, roleId, organizationId } = schema.parse(body)

    // Verify caller is an admin of this org via user_role_assignment
    const assignments = await queryStdb<{ role_id: number; organization_id: number; is_active: boolean }>(
      `SELECT role_id, organization_id, is_active FROM user_role_assignment WHERE identity = 0x${identityHex.replace(/^0x/, '')} AND organization_id = ${organizationId} AND is_active = true`
    )
    if (!assignments.length) {
      return NextResponse.json({ error: 'Forbidden: not a member of this organization' }, { status: 403 })
    }

    // Check the role name is admin/owner (look up role)
    const roles = await queryStdb<{ id: number; name: string; is_system: boolean }>(
      `SELECT id, name FROM role WHERE id IN (${assignments.map(a => a.role_id).join(',')}) AND organization_id = ${organizationId}`
    )
    const isAdmin = roles.some(r => ['owner', 'admin', 'administrator'].includes(r.name.toLowerCase()))
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 })
    }

    // Generate invite token (7-day expiry)
    const { token, tokenHash } = await generateSecureToken()
    const expiresAt = nowMicros() + BigInt(7 * 24 * 60 * 60 * 1000 * 1000) // 7 days in micros

    await callStdbReducer('create_user_invite', [
      organizationId,
      roleId,
      email,
      tokenHash,
      identityHex,
      expiresAt.toString(),
    ])

    // Get org name for email
    const orgs = await queryStdb<{ name: string }>(
      `SELECT name FROM organization WHERE id = ${organizationId}`
    )
    const orgName = orgs[0]?.name ?? 'Lumiere ERP'

    await sendInviteEmail(email, 'Your colleague', orgName, token)

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Invalid input' }, { status: 400 })
    }
    console.error('[auth/invite]', err)
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
  }
}
