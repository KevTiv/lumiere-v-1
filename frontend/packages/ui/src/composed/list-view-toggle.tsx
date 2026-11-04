"use client"

import type { ComponentType } from "react"
import { Button } from "../components/button"

export interface ListViewOption<T extends string> {
  value: T
  label: string
  icon: ComponentType<{ className?: string }>
}

/** Display names can agree without changing callers' stored mode identifiers. */
export function ListViewToggle<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (value: T) => void
  options: readonly ListViewOption<T>[]
  label: string
}) {
  return <div role="group" aria-label={label} className="flex w-fit min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
    {options.map(({ value: choice, label: choiceLabel, icon: Icon }) => <Button
      key={choice}
      variant={value === choice ? "secondary" : "ghost"}
      size="sm"
      className="h-auto min-h-11 min-w-0 gap-1.5 whitespace-normal px-3 text-left aria-pressed:shadow-sm"
      onClick={() => onChange(choice)}
      aria-pressed={value === choice}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{choiceLabel}</span>
    </Button>)}
  </div>
}
