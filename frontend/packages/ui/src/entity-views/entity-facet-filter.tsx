"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useMemo } from "react"
import { CirclePlus, X } from "lucide-react"
import type { EntityFilter, EntityRow } from "../lib/entity-view-types"
import { decodeFacetValues, encodeFacetValues, rowFilterValue } from "../lib/entity-table-engine"
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover"
import { Button } from "../components/button"
import { Badge } from "../components/badge"
import { Checkbox } from "../components/checkbox"
import { Separator } from "../components/separator"

interface EntityFacetFilterProps {
  filter: EntityFilter
  /** Stored filter value (`__all__`, one value, or several encoded). */
  value: string | undefined
  /** Rows the per-option counts are taken from. */
  rows: readonly EntityRow[]
  disabled?: boolean
  onChange: (value: string) => void
}

/** Multi-select facet: a dashed button listing ticked options, a popover of checkboxes with counts. */
export function EntityFacetFilter({ filter, value, rows, disabled, onChange }: EntityFacetFilterProps) {
  useTranslation()
  const selected = useMemo(() => new Set(decodeFacetValues(value).map((v) => v.toLowerCase())), [value])
  const options = filter.options ?? []
  const counts = useMemo(() => {
    const byValue = new Map<string, number>()
    for (const row of rows) {
      const key = rowFilterValue(row, filter.key).toLowerCase()
      byValue.set(key, (byValue.get(key) ?? 0) + 1)
    }
    return byValue
  }, [rows, filter.key])

  const toggle = (optionValue: string) => {
    const lower = optionValue.toLowerCase()
    const next = options
      .map((option) => option.value)
      .filter((candidate) =>
        candidate.toLowerCase() === lower ? !selected.has(lower) : selected.has(candidate.toLowerCase()),
      )
    onChange(encodeFacetValues(next))
  }

  const chosen = options.filter((option) => selected.has(option.value.toLowerCase()))

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-dashed"
            aria-label={filter.label}
            data-testid={`entity-facet-${filter.key}`}
          />
        }
      >
        <CirclePlus className="mr-1.5 h-4 w-4" />
        {filter.label}
        {chosen.length > 0 ? (
          <>
            <Separator orientation="vertical" className="mx-2 h-4" />
            {chosen.length > 2 ? (
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {chosen.length} {i18n.t("ui.entityViews.entityFacetFilter.selected")}</Badge>
            ) : (
              <span className="flex gap-1">
                {chosen.map((option) => (
                  <Badge key={option.value} variant="secondary" className="rounded-sm px-1 font-normal">
                    {option.label}
                  </Badge>
                ))}
              </span>
            )}
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <ul role="listbox" aria-multiselectable="true" aria-label={filter.label} className="max-h-72 overflow-y-auto">
          {options.map((option) => {
            const isSelected = selected.has(option.value.toLowerCase())
            const id = `facet-${filter.key}-${option.value}`
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    id={id}
                    checked={isSelected}
                    onCheckedChange={() => toggle(option.value)}
                    data-testid={`entity-facet-option-${filter.key}-${option.value}`}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {counts.get(option.value.toLowerCase()) ?? 0}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {chosen.length > 0 ? (
          <>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => onChange(encodeFacetValues([]))}
              data-testid={`entity-facet-clear-${filter.key}`}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {i18n.t("ui.entityViews.entityFacetFilter.clearFilter")}</Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
