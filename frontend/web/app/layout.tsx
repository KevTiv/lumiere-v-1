import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from './providers'
import { getStdbSession } from '@/lib/api-session'
import {
  serverQueryUserRoleAssignments,
  serverQueryRoles,
} from '@lumiere/stdb/server'
import './globals.css'
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

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
  const session = await getStdbSession()
  const identityHex = session?.identityHex
  const organizationId = session?.organizationId
  const opts = session?.opts ?? {}
  const stdbModule = process.env.STDB_MODULE ?? process.env.NEXT_PUBLIC_STDB_MODULE ?? 'lumiere-v1-j1uo0'

  let serverRoleNames: string[] = []
  if (identityHex) {
    try {
      const [assignments, allRoles] = await Promise.all([
        serverQueryUserRoleAssignments(identityHex, opts),
        serverQueryRoles(opts),
      ])
      const assignedIds = new Set(
        (assignments as Array<Record<string, unknown>>)
          .filter((a) => a['isActive'])
          .map((a) => String(a['roleId']))
      )
      serverRoleNames = (allRoles as Array<Record<string, unknown>>)
        .filter((r) => assignedIds.has(String(r['id'])))
        .map((r) => String(r['name']))
    } catch {
      // Session token present but role query failed — render with empty role list
    }
  }

  const store = await cookies()
  const hasStdbCookie = Boolean(store.get("stdb_token")?.value)
  const devAdmin = process.env.NEXT_PUBLIC_DEV_ADMIN === "true"
  // Dev admin: allow first paint without cookies so the client can connect from localStorage
  // and bridge the token via saveStdbSession (WebSocket + /api/query then succeed).
  if (!hasStdbCookie && !devAdmin) redirect("/sign-in")

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers
          serverIdentity={identityHex}
          serverRoleNames={serverRoleNames}
          organizationId={organizationId}
          stdbModule={stdbModule}
        >
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
