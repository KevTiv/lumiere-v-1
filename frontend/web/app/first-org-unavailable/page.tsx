"use client"

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import Link from "next/link"

export default function FirstOrgUnavailablePage() {
  useRootTranslation()
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
      <section className="space-y-3 rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          {rootI18n.t("workspaceShell.ui.page.firstOrganization")}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {rootI18n.t("workspaceShell.ui.page.surfaceNotAdmittedYet")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {rootI18n.t("workspaceShell.ui.page.thisWorkspaceRemainsHiddenUntilItsRequiredProduct")}</p>
        <Link
          href="/accounting"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        >
          {rootI18n.t("workspaceShell.ui.page.returnToFinance")}</Link>
      </section>
    </main>
  )
}
