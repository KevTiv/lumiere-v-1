"use client"

import { useTranslation } from "@lumiere/i18n"

/** Counts describe successful loaded reads, including a genuinely empty collection. */
export function WorkLoadedCount({ count, isError, isPending }: { count: number; isError: boolean; isPending: boolean }) {
  const { t } = useTranslation()
  return <p className="text-xs text-muted-foreground" role="status" data-testid="work-loaded-count">
    {isError ? t("workBoard.readFailed") : isPending ? t("workBoard.loading") : t("workBoard.loaded", { count })}
  </p>
}
