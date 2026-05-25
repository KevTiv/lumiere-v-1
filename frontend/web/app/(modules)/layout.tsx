import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'
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
  if (!hasAuthenticatedIdentity(session)) {
    const headersList = await headers()
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
  return <ModulesShell>{children}</ModulesShell>
}
