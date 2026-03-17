import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from './providers'
import { getStdbSession } from '@/lib/stdb-session'
import {
  serverQueryUserRoleAssignments,
  serverQueryRoles,
} from '@lumiere/stdb/server'
import './globals.css'

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
  const { identityHex, opts } = await getStdbSession()

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
      // No session yet — user hasn't connected via WebSocket
    }
  }

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers serverIdentity={identityHex} serverRoleNames={serverRoleNames}>
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
