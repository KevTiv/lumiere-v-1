import { redirect } from 'next/navigation'
import { getStdbSession } from '@/lib/api-session'

export default async function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getStdbSession()
  if (session?.organizationId) {
    redirect('/overview')
  }
  return <>{children}</>
}
