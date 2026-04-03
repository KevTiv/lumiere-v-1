import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

export default async function DevLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Only allow access in development environment
  const headersList = await headers()
  const host = headersList.get('host') ?? ''

  // Check for dev environment indicators
  const isDev = process.env.NODE_ENV === 'development' ||
                host.includes('localhost') ||
                host.includes('127.0.0.1')

  if (!isDev) {
    notFound()
  }

  return <>{children}</>
}
