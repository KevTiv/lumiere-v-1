import { isWorkOsEnabled } from '@/lib/auth-mode'
import { hostedInviteCookieName, openHostedInvite } from '@/lib/hosted-invite-token'
import { workOsBrowserSession } from '@/lib/auth-credentials'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import NativeAcceptInvitePage from './native-accept-invite'
import HostedAcceptInvitePage from './hosted-accept-invite'

type SearchParams = { token?: string | string[] }

/** Hosted mode never serializes invite tokens into HTML, Flight, or OAuth state. */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  if (!isWorkOsEnabled()) return <NativeAcceptInvitePage />
  const params = await searchParams
  if (params.token !== undefined) {
    const token = typeof params.token === 'string' && params.token.length <= 128
      ? `?token=${encodeURIComponent(params.token)}`
      : ''
    redirect(`/auth/invite/prepare${token}`)
  }
  const store = await cookies()
  const inviteToken = openHostedInvite(store.get(hostedInviteCookieName())?.value)
  const { user } = await workOsBrowserSession()
  return <HostedAcceptInvitePage signedIn={Boolean(user)} hasInvite={Boolean(inviteToken)} />
}
