"use client"

import Link from "next/link"

/**
 * Module-level error boundary. A module page that cannot load its critical
 * resources (denied or unavailable) fails closed on the server; this keeps the
 * shell and gives the operator a recovery path instead of a bare application error.
 */
export default function ModuleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-2xl items-center px-6 py-16" data-testid="module-load-error">
      <section className="space-y-3 rounded-xl border bg-card p-8 text-card-foreground shadow-sm" role="alert">
        <h1 className="text-xl font-semibold tracking-tight">This workspace could not be loaded</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          You may not have access to it, or one of its data sources is unavailable. Nothing was changed.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
            data-testid="module-load-error-retry"
          >
            Try again
          </button>
          <Link
            href="/accounting"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Return to Finance
          </Link>
        </div>
      </section>
    </main>
  )
}
