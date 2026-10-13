import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Providers } from './providers'
import './globals.css'

import { getBrowserStdbSession, hasAuthenticatedIdentity } from '@/lib/browser-session'
import { requireServerQueryRows, serverFetchQueryListState } from '@/lib/server-query'
import { resolveSessionCompanyIds } from '@/lib/session-company-scope'

export const metadata: Metadata = {
  title: 'Lumiere ERP',
  description: 'Lumiere ERP',
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
  const fieldAccess = session?.fieldAccess

  let serverRoleNames: string[] = []
  if (identityHex && session) {
    {
      const [assignmentsState, rolesState] = await Promise.all([
        serverFetchQueryListState(session, "user-roles"),
        serverFetchQueryListState(session, "roles"),
      ])
      const assignments = requireServerQueryRows(assignmentsState, "user-roles")
      const allRoles = requireServerQueryRows(rolesState, "roles")
      const assignedIds = new Set(
        assignments
          .filter((a) => a["isActive"])
          .map((a) => String(a["roleId"]))
      )
      serverRoleNames = allRoles
        .filter((r) => assignedIds.has(String(r["id"])))
        .map((r) => String(r["name"]))
    }
  }

  let companyIds: readonly number[] | undefined
  if (organizationId != null && session) {
    {
      const [companiesState, membershipsState] = await Promise.all([
        serverFetchQueryListState(session, "companies"),
        serverFetchQueryListState(session, "user-organization"),
      ])
      const companies = requireServerQueryRows(companiesState, "companies")
      const memberships = requireServerQueryRows(membershipsState, "user-organization")
      const validCompanies = companies
        .map((row) => ({
          id: Number(row["id"]),
          isParent: Boolean(row["isParent"]),
        }))
        .filter((company) => Number.isSafeInteger(company.id) && company.id > 0)
      const validCompanyIds = new Set(validCompanies.map((company) => company.id))
      const membershipCompanyId = memberships
        .map((row) => Number(row["companyId"]))
        .find((id) => Number.isSafeInteger(id) && id > 0 && validCompanyIds.has(id))
      const allowedCompanyIds = resolveSessionCompanyIds({
        companies: validCompanies,
        membershipCompanyId,
        roleNames: serverRoleNames,
      })
      companyIds = allowedCompanyIds.length === 0 ? undefined : allowedCompanyIds
    }
  }

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <Providers
          serverIdentity={identityHex}
          serverRoleNames={serverRoleNames}
          organizationId={organizationId}
          companyIds={companyIds}
          fieldAccess={fieldAccess}
        >
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
