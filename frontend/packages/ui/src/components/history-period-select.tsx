"use client"

import { useEffect, useId, useState } from "react"
import { Calendar } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import {
  HISTORY_PRESETS,
  historyPeriodDates,
  parseHistoryPeriod,
  serializeHistoryPeriod,
  validateHistoryPeriod,
  type HistoryBounds,
  type HistoryDates,
  type HistoryPeriod,
  type HistoryPreset,
} from "@lumiere/erp-shared/history-period"
import { Button } from "./button"
import { Input } from "./input"
import { Label } from "./label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { cn } from "../lib/utils"

const presetLabels: Record<HistoryPreset, { key: string; defaultValue: string }> = {
  today: { key: "today", defaultValue: "Today" },
  "7d": { key: "last7Days", defaultValue: "Last 7 days" },
  "30d": { key: "last30Days", defaultValue: "Last 30 days" },
  "90d": { key: "last90Days", defaultValue: "Last 90 days" },
  "180d": { key: "last180Days", defaultValue: "Last 180 days" },
  ytd: { key: "yearToDate", defaultValue: "Year to date" },
  all: { key: "all", defaultValue: "All history" },
}

export interface HistoryPeriodSelectProps {
  value: HistoryPeriod
  onChange: (period: HistoryPeriod) => void
  timeZone?: string
  coverage?: HistoryBounds
  /** Source-calendar coverage can be supplied directly without converting timestamps. */
  coverageDates?: HistoryDates
  label?: string
  disabled?: boolean
  className?: string
}

/** Custom dates are a draft until valid and applied; changing inputs never runs a partial query. */
export function HistoryPeriodSelect({
  value,
  onChange,
  timeZone = "UTC",
  coverage,
  coverageDates,
  label,
  disabled = false,
  className,
}: HistoryPeriodSelectProps) {
  const { t } = useTranslation()
  const id = useId()
  const valueKey = serializeHistoryPeriod(value)
  const [customEditing, setCustomEditing] = useState(typeof value === "object")
  const [from, setFrom] = useState(typeof value === "object" ? value.from : "")
  const [through, setThrough] = useState(typeof value === "object" ? value.through : "")
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const selected = parseHistoryPeriod(valueKey)
    if (!selected) return
    setCustomEditing(typeof selected === "object")
    setFrom(typeof selected === "object" ? selected.from : "")
    setThrough(typeof selected === "object" ? selected.through : "")
    setSubmitted(false)
  }, [valueKey])

  const draft = { kind: "custom" as const, from, through }
  const validation = validateHistoryPeriod(draft)
  const errorCode = submitted && !validation.valid ? validation.error : null
  const error = errorCode === "invalid-from"
    ? t("common.historyPeriod.invalidFrom", { defaultValue: "Enter a valid start date." })
    : errorCode === "invalid-through"
      ? t("common.historyPeriod.invalidThrough", { defaultValue: "Enter a valid end date." })
      : errorCode === "reversed"
        ? t("common.historyPeriod.reversed", { defaultValue: "The end date must be on or after the start date." })
        : null
  const apply = () => {
    setSubmitted(true)
    if (validation.valid) onChange(validation.period)
  }

  return (
    <div className={cn("flex max-w-full flex-wrap items-end gap-2", className)}>
      <Select
        value={customEditing ? "custom" : typeof value === "string" ? value : "custom"}
        disabled={disabled}
        onValueChange={(next) => {
          setSubmitted(false)
          if (next === "custom") {
            const emptyCoverage = value === "all" && coverage?.startMs != null && coverage.startMs === coverage.endMs
            const dates = value === "all" && coverageDates ? coverageDates
              : emptyCoverage ? { from: null, through: null }
                : historyPeriodDates(value, { timeZone, coverage })
            setFrom(dates.from ?? "")
            setThrough(dates.through ?? "")
            setCustomEditing(true)
          } else {
            const preset = HISTORY_PRESETS.find((candidate) => candidate === next)
            if (preset) {
              setCustomEditing(false)
              onChange(preset)
            }
          }
        }}
      >
        <SelectTrigger
          className="w-auto min-w-40 gap-2"
          aria-label={label ?? t("common.historyPeriod.label", { defaultValue: "Date range" })}
        >
          <Calendar className="size-4 shrink-0" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {HISTORY_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {t(`common.historyPeriod.${presetLabels[preset].key}`, { defaultValue: presetLabels[preset].defaultValue })}
            </SelectItem>
          ))}
          <SelectItem value="custom">
            {t("common.historyPeriod.custom", { defaultValue: "Custom dates" })}
          </SelectItem>
        </SelectContent>
      </Select>
      {customEditing && (
        <fieldset disabled={disabled} className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
          <legend className="sr-only">
            {t("common.historyPeriod.customDates", { defaultValue: "Custom date range" })}
          </legend>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id + "-from"}>{t("common.historyPeriod.from", { defaultValue: "From" })}</Label>
            <Input
              id={id + "-from"}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); apply() }
              }}
              aria-invalid={errorCode === "invalid-from" || undefined}
              aria-describedby={error ? id + "-error" : undefined}
              className="w-40"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={id + "-through"}>{t("common.historyPeriod.through", { defaultValue: "Through" })}</Label>
            <Input
              id={id + "-through"}
              type="date"
              value={through}
              onChange={(event) => setThrough(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); apply() }
              }}
              aria-invalid={errorCode === "invalid-through" || errorCode === "reversed" || undefined}
              aria-describedby={error ? id + "-error" : undefined}
              className="w-40"
            />
          </div>
          <Button type="button" variant="outline" onClick={apply} disabled={disabled}>
            {t("common.historyPeriod.apply", { defaultValue: "Apply dates" })}
          </Button>
          {error && <p id={id + "-error"} role="alert" className="w-full text-sm text-destructive">{error}</p>}
        </fieldset>
      )}
    </div>
  )
}
