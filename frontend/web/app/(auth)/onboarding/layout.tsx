import { redirect } from 'next/navigation'
import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'

export default async function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getBrowserStdbSession()
  if (!hasAuthenticatedIdentity(session)) {
    redirect('/sign-in')
  }
  if (session?.organizationId) {
    redirect('/overview')
  }
  return <>{children}</>
}
