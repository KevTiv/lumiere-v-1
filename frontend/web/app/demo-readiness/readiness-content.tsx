"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"

export type DemoModuleKey = "crm" | "sales" | "purchasing" | "inventory" | "manufacturing" | "accounting" | "hr" | "projects" | "expenses" | "reports" | "documents" | "workflows" | "forms" | "settings" | "helpdesk" | "fleet" | "pos" | "subscriptions"
export type DemoReadinessResult = { resource: string } & (
  | { status: "http-error"; httpStatus: number }
  | { status: "unexpected-response" }
  | { status: "rows"; count: number }
  | { status: "unavailable" }
)
export interface DemoReadinessCheck {
  moduleKey: DemoModuleKey
  href: string
  results: DemoReadinessResult[]
}

export function DemoReadinessContent({ checks }: { checks: DemoReadinessCheck[] }) {
  const { t } = useTranslation()
  const resultLabel = (result: DemoReadinessResult) => {
    switch (result.status) {
      case "http-error": return t("demoReadiness.queryFailed", { status: result.httpStatus })
      case "unexpected-response": return t("demoReadiness.unexpectedResponse")
      case "unavailable": return t("demoReadiness.queryUnavailable")
      case "rows": return result.count > 0 ? t("demoReadiness.rowsReturned", { count: result.count }) : t("demoReadiness.empty")
    }
  }

  return <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
    <Link className="text-sm underline" href="/overview">{t("demoReadiness.backToWorkspace")}</Link>
    <header className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("demoReadiness.previewLabel")}</p>
      <h1 className="text-3xl font-semibold">{t("demoReadiness.title")}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{t("demoReadiness.scopeNotice")}</p>
      <p className="text-sm">{t("demoReadiness.syntheticDataNotice")}</p>
    </header>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {checks.map(check => <section key={check.moduleKey} className="rounded-xl border border-border p-4">
        <Link className="font-semibold underline underline-offset-4" href={check.href}>{t(`demoReadiness.modules.${check.moduleKey}`)}</Link>
        <ul className="mt-3 space-y-2 text-sm">
          {check.results.map(result => <li key={result.resource}>
            <span className="block text-xs text-muted-foreground">{result.resource}</span>
            <span className={result.status === "rows" && result.count > 0 ? "text-foreground" : "text-amber-600 dark:text-amber-400"}>{resultLabel(result)}</span>
          </li>)}
        </ul>
      </section>)}
    </div>
  </main>
}
