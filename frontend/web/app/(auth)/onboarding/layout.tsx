import { redirect } from 'next/navigation'
import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'
import { approvedAdditionalOrganizationCode } from '@/lib/onboarding-approval.server'

export default async function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getBrowserStdbSession()
  if (!hasAuthenticatedIdentity(session)) {
    redirect('/sign-in')
  }
  if (session?.organizationId && !await approvedAdditionalOrganizationCode(session)) {
    redirect('/overview')
  }
  return <>{children}</>
}
