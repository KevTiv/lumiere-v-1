import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'
import {
  isFirstOrgPathAdmitted,
  isFirstTestOrganization,
  sessionIsOrganizationAdmin,
} from '@/lib/first-org-exposure'
import ModulesShell from './modules-shell'

function normalizeCallbackPath(value: string | null) {
  if (!value) return '/overview'
  try {
    const url = value.startsWith('http') ? new URL(value) : new URL(value, 'http://localhost')
    return `${url.pathname}${url.search}`
  } catch {
    return value.startsWith('/') ? value : '/overview'
  }
}

export default async function ModulesLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getBrowserStdbSession()
  const headersList = await headers()
  if (!hasAuthenticatedIdentity(session)) {
    const callbackUrl = normalizeCallbackPath(
      headersList.get('x-next-url') ??
        headersList.get('x-invoke-path') ??
        headersList.get('next-url'),
    )
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  if (!session?.organizationId) {
    redirect('/onboarding')
  }

  const firstOrgProfile = isFirstTestOrganization(session.organizationId)
  if (firstOrgProfile) {
    const pathname = headersList.get('x-lumiere-pathname')
    if (!pathname || !isFirstOrgPathAdmitted(pathname, sessionIsOrganizationAdmin(session))) {
      redirect('/first-org-unavailable')
    }
  }

  return <ModulesShell firstOrgProfile={firstOrgProfile}>{children}</ModulesShell>
}
