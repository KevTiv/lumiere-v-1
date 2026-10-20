'use server'

import { workOsRedirectUri } from '@/lib/workos-config'

import { isWorkOsEnabled, safeAuthReturnTo } from '@/lib/auth-mode'
import { getSignInUrl, getSignUpUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import { POST_AUTH_PATHS } from '@/lib/post-auth-destination'

function returnToFromForm(formData: FormData, fallback: string): string {
  if (!isWorkOsEnabled()) throw new Error('Hosted authentication is disabled')
  return safeAuthReturnTo(formData.get('returnTo'), fallback)
}

export async function redirectToWorkOsSignIn(formData: FormData) {
  const next = returnToFromForm(formData, POST_AUTH_PATHS.overview)
  const returnTo = `/auth/complete?next=${encodeURIComponent(next)}`
  const url = await getSignInUrl({ returnTo, redirectUri: workOsRedirectUri() })
  redirect(url)
}

export async function redirectToWorkOsSignUp(formData: FormData) {
  const next = returnToFromForm(formData, POST_AUTH_PATHS.onboarding)
  const returnTo = `/auth/complete?next=${encodeURIComponent(next)}`
  const url = await getSignUpUrl({ returnTo, redirectUri: workOsRedirectUri() })
  redirect(url)
}

/**
 * AuthKit sign-in screen includes “Forgot password” for email/password users.
 */
export async function redirectToWorkOsSignInForPasswordReset(formData: FormData) {
  const returnTo = returnToFromForm(formData, '/sign-in')
  const url = await getSignInUrl({ returnTo, redirectUri: workOsRedirectUri() })
  redirect(url)
}

/** Return to the token-free invite page. The invitation is held in an HTTP-only cookie. */
export async function redirectToWorkOsForInvite(_formData: FormData) {
  if (!isWorkOsEnabled()) throw new Error('Hosted authentication is disabled')
  const url = await getSignInUrl({ returnTo: '/accept-invite', redirectUri: workOsRedirectUri() })
  redirect(url)
}
