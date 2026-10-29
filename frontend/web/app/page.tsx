import { getBrowserStdbSession, hasAuthenticatedIdentity } from "@/lib/browser-session"
import { LandingActions, LandingIntro } from "./landing-actions"

export default async function LandingPage() {
  const session = await getBrowserStdbSession()
  const authenticated = hasAuthenticatedIdentity(session)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-6 py-16 text-center">
        <LandingIntro />
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LandingActions authenticated={authenticated} />
        </div>
      </section>
    </main>
  )
}

