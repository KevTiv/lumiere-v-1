import { getBrowserStdbSession, hasAuthenticatedIdentity } from "@/lib/browser-session"
import { LandingActions } from "./landing-actions"

export default async function LandingPage() {
  const session = await getBrowserStdbSession()
  const authenticated = hasAuthenticatedIdentity(session)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
          Lumiere ERP
        </div>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Run your operations from one modular workspace.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Connect sales, inventory, accounting, projects, and service teams with a
          real-time ERP shell built for modern workflows.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LandingActions authenticated={authenticated} />
        </div>
      </section>
    </main>
  )
}

