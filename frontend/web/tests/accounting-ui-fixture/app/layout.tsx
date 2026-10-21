import "./globals.css"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

// Module fixtures exercise URL-bound workspaces; render them per request,
// like the authenticated app, rather than prerendering one static tab state.
export const dynamic = "force-dynamic"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body className="font-sans antialiased">{children}</body></html>
}
