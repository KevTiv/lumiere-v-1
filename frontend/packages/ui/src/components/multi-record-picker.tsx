"use client"

import { useState, type KeyboardEvent } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { cn } from "../lib/utils"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import type { RecordPickerOption } from "./record-picker"

export interface MultiRecordPickerProps {
  /** Ids of the chosen records, in the order they were chosen. */
  value: ReadonlyArray<string>
  onChange: (value: string[]) => void
  options: ReadonlyArray<RecordPickerOption>
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** Label of the button that removes one chip; receives the chip's label. */
  removeLabel?: (label: string) => string
  /** Chip text for a chosen value that is no longer among the options. */
  unavailableLabel?: (value: string) => string
  disabled?: boolean
  invalid?: boolean
  id?: string
  className?: string
  "data-testid"?: string
  "aria-describedby"?: string
}

interface Chip {
  value: string
  label: string
  /** Disabled or no-longer-listed choices cannot be edited here, so they stay put. */
  locked: boolean
}

/**
 * Choose several linked records: chosen ones show as removable chips, the list narrows as you type,
 * Enter toggles the highlighted record, and Backspace in an empty search removes the last chip.
 */
export function MultiRecordPicker({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No matches",
  removeLabel = (label) => `Remove ${label}`,
  unavailableLabel = (missing) => missing,
  disabled,
  invalid,
  id,
  className,
  "data-testid": testId,
  "aria-describedby": describedBy,
}: MultiRecordPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selected = new Set(value)

  const chips: Chip[] = value.map((item) => {
    const option = options.find((candidate) => candidate.value === item)
    return option
      ? { value: item, label: option.label, locked: !!option.disabled }
      : { value: item, label: unavailableLabel(item), locked: true }
  })

  const remove = (item: string) => onChange(value.filter((current) => current !== item))
  const toggle = (item: string) => (selected.has(item) ? remove(item) : onChange([...value, item]))

  const removeLast = (event: KeyboardEvent) => {
    if (event.key !== "Backspace" || search !== "" || disabled) return
    const last = [...chips].reverse().find((chip) => !chip.locked)
    if (!last) return
    event.preventDefault()
    remove(last.value)
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1",
        invalid && "border-destructive",
        disabled && "opacity-50",
        className,
      )}
    >
      {chips.length > 0 ? (
        <ul className="contents" data-testid={testId ? `${testId}-chips` : undefined}>
          {chips.map((chip) => (
            <li
              key={chip.value}
              data-locked={chip.locked || undefined}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-sm bg-muted py-0.5 pl-2 text-sm",
                chip.locked ? "pr-2 text-muted-foreground" : "pr-0.5",
              )}
            >
              <span className="truncate">{chip.label}</span>
              {chip.locked || disabled ? null : (
                <button
                  type="button"
                  aria-label={removeLabel(chip.label)}
                  onClick={() => remove(chip.value)}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-8"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch("")
        }}
      >
        <PopoverTrigger
          disabled={disabled}
          render={
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              data-testid={testId}
              onKeyDown={removeLast}
              className="flex min-h-7 min-w-24 flex-1 items-center justify-between gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed pointer-coarse:min-h-11"
            />
          }
        >
          <span className="truncate">{placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              onKeyDown={removeLast}
            />
            <CommandList aria-multiselectable="true">
              <CommandEmpty>{emptyText}</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // cmdk filters on this text: the name, plus the id so a record can be found by it.
                  value={`${option.label} #${option.value}`}
                  disabled={option.disabled}
                  data-checked={selected.has(option.value)}
                  aria-checked={selected.has(option.value)}
                  onSelect={() => toggle(option.value)}
                  className="pointer-coarse:min-h-11 [&>svg:last-child]:hidden"
                >
                  <span
                    aria-hidden="true"
                    data-slot="option-checkbox"
                    data-checked={selected.has(option.value)}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                      selected.has(option.value) && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {selected.has(option.value) && <Check className="size-3.5" />}
                  </span>
                  {option.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
