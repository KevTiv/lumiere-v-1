/**
 * After AuthKit callback, completes org invite when OAuth `state` carried the invite token.
 */
import 'server-only'

import type { User } from '@workos-inc/node'
import {
  callStdbReducer,
  findCredentialByWorkosUserId,
  findInviteByTokenHash,
  getRoleNameInOrganization,
  microsToDate,
} from '@/lib/stdb-auth-server'

export async function completeInviteAfterWorkOsAuth(
  user: User,
  inviteTokenPlain: string | undefined,
): Promise<void> {
  if (!inviteTokenPlain?.trim()) {
    return
  }

  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(inviteTokenPlain.trim()),
  )
  const tokenHash = Buffer.from(hashBuffer).toString('hex')
  const invite = await findInviteByTokenHash(tokenHash)
  if (!invite) {
    console.warn('[workos-invite] invite not found for OAuth state')
    return
  }
  if (invite.accepted_at !== null) {
    console.warn('[workos-invite] invite already accepted')
    return
  }
  if (microsToDate(invite.expires_at) < new Date()) {
    throw new Error('Invitation has expired')
  }

  const email = user.email?.trim() ?? ''
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error('Signed-in email does not match invitation')
  }

  const cred = await findCredentialByWorkosUserId(user.id)
  if (!cred) {
    throw new Error('Account not ready — try again')
  }

  const roleName = await getRoleNameInOrganization(invite.role_id, invite.organization_id)
  if (!roleName) {
    throw new Error('Invite role not found')
  }

  await callStdbReducer('add_org_member', [
    cred.identity,
    invite.organization_id,
    {
      role_name: roleName,
      company_id: null,
      job_title: null,
      department_id: null,
      employee_id: null,
      is_active: true,
      is_default: true,
      metadata: null,
    },
  ])

  await callStdbReducer('mark_invite_accepted', [invite.id])
}
