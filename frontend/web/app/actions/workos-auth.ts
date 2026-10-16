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
  const returnTo = returnToFromForm(formData, POST_AUTH_PATHS.overview)
  const url = await getSignInUrl({ returnTo, redirectUri: workOsRedirectUri() })
  redirect(url)
}

export async function redirectToWorkOsSignUp(formData: FormData) {
  const returnTo = returnToFromForm(formData, POST_AUTH_PATHS.onboarding)
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

/** Legacy local invite links never grant membership in hosted mode. Admission is operator-owned. */
export async function redirectToWorkOsForInvite(_formData: FormData) {
  if (!isWorkOsEnabled()) throw new Error('Hosted authentication is disabled')
  const url = await getSignInUrl({ returnTo: POST_AUTH_PATHS.overview, redirectUri: workOsRedirectUri() })
  redirect(url)
}
