"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"

/**
 * Shown when a module loads without a valid organization (e.g. user skipped onboarding).
 */
export function MissingOrganization() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">
          {t("common.noOrganization.title")}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("common.noOrganization.description")}
        </p>
      </div>
      <Link
        href="/onboarding"
        className="text-primary text-sm font-medium underline underline-offset-4 hover:no-underline"
      >
        {t("common.noOrganization.goToOnboarding")}
      </Link>
    </div>
  )
}
