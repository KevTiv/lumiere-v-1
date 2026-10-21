"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "./button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface RecordPickerOption {
  value: string
  label: string
  disabled?: boolean
}

export interface RecordPickerProps {
  /** Id of the chosen record; "" when none. */
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<RecordPickerOption>
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
  className?: string
  "data-testid"?: string
  "aria-describedby"?: string
}

/**
 * Choose one linked record from a list long enough that scrolling for it is slow: type to narrow
 * by name (or id), then pick. A drop-in for a plain select that stores the same string value.
 */
export function RecordPicker({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No matches",
  disabled,
  invalid,
  id,
  className,
  "data-testid": testId,
  "aria-describedby": describedBy,
}: RecordPickerProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-testid={testId}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                // cmdk filters on this text: the name, plus the id so a record can be found by it.
                value={`${option.label} #${option.value}`}
                disabled={option.disabled}
                onSelect={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn("mr-2 h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
