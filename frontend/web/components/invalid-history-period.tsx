"use client"

import { useTranslation } from "@lumiere/i18n"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Button } from "@lumiere/ui/components/button"

/** Invalid links must not show built-in "All" figures beside unavailable saved widgets. */
export function InvalidHistoryPeriod({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation()
  return <Alert>
    <AlertDescription className="flex flex-wrap items-center gap-3">
      <p>{t("common.historyPeriod.invalidLink")}</p>
      <Button type="button" variant="outline" onClick={onClear}>{t("common.historyPeriod.clear")}</Button>
    </AlertDescription>
  </Alert>
}
