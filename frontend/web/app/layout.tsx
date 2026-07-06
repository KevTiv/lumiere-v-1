import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from './providers'
import './globals.css'

import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'
import { serverFetchQueryListAllowEmpty } from '@/lib/server-query'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Modular ERP Dashboard',
  description: 'Enterprise dashboard with configurable layouts and real-time analytics',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getBrowserStdbSession()
  const identityHex = hasAuthenticatedIdentity(session) ? session?.identityHex : undefined
  const organizationId = session?.organizationId

  let serverRoleNames: string[] = []
  if (identityHex && session) {
    try {
      const assignments = await serverFetchQueryListAllowEmpty(session, "user-roles")
      const allRoles = await serverFetchQueryListAllowEmpty(session, "roles")
      const assignedIds = new Set(
        assignments
          .filter((a) => a["isActive"])
          .map((a) => String(a["roleId"]))
      )
      serverRoleNames = allRoles
        .filter((r) => assignedIds.has(String(r["id"])))
        .map((r) => String(r["name"]))
    } catch {
      // Session token present but role query failed — render with empty role list
    }
  }

  let companyIds: readonly number[] | undefined
  if (organizationId != null && session) {
    try {
      const rows = await serverFetchQueryListAllowEmpty(session, "companies")
      companyIds = rows
        .map((r) => Number(r["id"]))
        .filter((id) => Number.isFinite(id))
    } catch {
      companyIds = undefined
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers
          serverIdentity={identityHex}
          serverRoleNames={serverRoleNames}
          organizationId={organizationId}
          companyIds={companyIds}
        >
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
