import { withAuth } from '@workos-inc/authkit-nextjs'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveApiServerBaseUrl } from '@/lib/api-server-forward'
import { isWorkOsEnabled, safeAuthReturnTo } from '@/lib/auth-mode'
import { hostedInviteCookieName, openHostedInvite } from '@/lib/hosted-invite-token'
import { POST_AUTH_PATHS } from '@/lib/post-auth-destination'

export default async function CompleteAuthentication({ searchParams }: {
  searchParams: Promise<{ next?: string }>
}) {
  if (!isWorkOsEnabled()) redirect('/sign-in')
  const session = await withAuth()
  if (!session.accessToken) redirect('/sign-in')
  const store = await cookies()
  if (openHostedInvite(store.get(hostedInviteCookieName())?.value)) redirect('/accept-invite')
  const base = resolveApiServerBaseUrl()
  const response = base ? await fetch(`${base}/v1/auth/workos/status`, {
    headers: { authorization: `Bearer ${session.accessToken}` }, cache: 'no-store', redirect: 'error',
  }).catch(() => null) : null
  if (!response?.ok) {
    redirect('/sign-in?error=authentication_unavailable')
  }
  const result = await response.json() as { status?: string }
  if (result.status === 'onboarding') redirect(POST_AUTH_PATHS.onboarding)
  if (result.status !== 'ready') redirect(`/sign-in?error=${result.status === 'membership_suspended' ? 'membership_suspended' : 'invitation_required'}`)
  const next = safeAuthReturnTo((await searchParams).next)
  redirect(/^\/(?:sign-in|sign-up|auth|accept-invite|onboarding)(?:\/|\?|$)/.test(next) ? POST_AUTH_PATHS.overview : next)
}
