export default function FirstOrgUnavailablePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
      <section className="space-y-3 rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          First organization
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Surface not admitted yet
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This workspace remains hidden until its required product evidence is
          accepted. Hiding it does not remove the capability from the
          convergence backlog.
        </p>
      </section>
    </main>
  )
}
