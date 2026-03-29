import { redirect } from 'next/navigation'
import { getStdbSession } from '@/lib/api-session'
import ModulesShell from './modules-shell'

export default async function ModulesLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    redirect('/onboarding')
  }
  return <ModulesShell>{children}</ModulesShell>
}
