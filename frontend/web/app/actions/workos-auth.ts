'use server'

import { getSignInUrl, getSignUpUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import { findInviteByTokenHash, microsToDate } from '@/lib/stdb-auth-server'
import { POST_AUTH_PATHS } from '@/lib/post-auth-destination'

function returnToFromForm(formData: FormData, fallback: string): string {
  const raw = formData.get('returnTo')
  return typeof raw === 'string' && raw.length > 0 ? raw : fallback
}

export async function redirectToWorkOsSignIn(formData: FormData) {
  const returnTo = returnToFromForm(formData, POST_AUTH_PATHS.overview)
  const url = await getSignInUrl({ returnTo })
  redirect(url)
}

export async function redirectToWorkOsSignUp(formData: FormData) {
  const returnTo = returnToFromForm(formData, POST_AUTH_PATHS.onboarding)
  const url = await getSignUpUrl({ returnTo })
  redirect(url)
}

/**
 * AuthKit sign-in screen includes “Forgot password” for email/password users.
 */
export async function redirectToWorkOsSignInForPasswordReset(formData: FormData) {
  const returnTo = returnToFromForm(formData, '/sign-in')
  const url = await getSignInUrl({ returnTo })
  redirect(url)
}

/**
 * Invite acceptance: OAuth `state` carries the plaintext invite token for post-auth completion.
 */
export async function redirectToWorkOsForInvite(formData: FormData) {
  const tokenRaw = formData.get('token')
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : ''
  if (!token) {
    redirect('/accept-invite?inviteErr=missing')
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = Buffer.from(hashBuffer).toString('hex')
  const invite = await findInviteByTokenHash(tokenHash)
  if (!invite) {
    redirect(`/accept-invite?token=${encodeURIComponent(token)}&inviteErr=invalid`)
  }
  if (invite.accepted_at !== null) {
    redirect(`/accept-invite?token=${encodeURIComponent(token)}&inviteErr=used`)
  }
  if (microsToDate(invite.expires_at) < new Date()) {
    redirect(`/accept-invite?token=${encodeURIComponent(token)}&inviteErr=expired`)
  }

  const url = await getSignUpUrl({
    returnTo: POST_AUTH_PATHS.overview,
    loginHint: invite.email,
    state: token,
  })
  redirect(url)
}
