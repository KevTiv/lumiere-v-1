"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"

/** Invalid links must not show built-in "All" figures beside unavailable saved widgets. */
export function InvalidHistoryPeriod({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation()
  return <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm">
    <p>{t("common.historyPeriod.invalidLink")}</p>
    <Button type="button" variant="outline" onClick={onClear}>{t("common.historyPeriod.clear")}</Button>
  </div>
}
