"use client"

import { useTranslation } from "@lumiere/i18n"
import { ToggleGroup, ToggleGroupItem } from "../components/toggle-group"
import type { TableDensity } from "../hooks/use-table-density"

export function TableDensityControl({
  value,
  onChange,
}: {
  value: TableDensity
  onChange: (value: TableDensity) => void
}) {
  const { t } = useTranslation()
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => {
        const next = values[0]
        if (next === "comfortable" || next === "compact") onChange(next)
      }}
      variant="default"
      size="sm"
      spacing={1}
      className="rounded-lg border border-input bg-muted/40 p-0.5"
      aria-label={t("financeReview.density", { defaultValue: "Row density" })}
      data-testid="table-density"
    >
      <ToggleGroupItem value="comfortable" className="aria-pressed:bg-background aria-pressed:shadow-sm">
        {t("financeReview.comfortable", { defaultValue: "Comfortable" })}
      </ToggleGroupItem>
      <ToggleGroupItem value="compact" className="aria-pressed:bg-background aria-pressed:shadow-sm">
        {t("financeReview.compact", { defaultValue: "Compact" })}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
