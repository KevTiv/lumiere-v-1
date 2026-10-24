"use client"

import React, { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "../lib/utils"
import { formatLocaleNumber, parseLocaleNumber, storedNumericValue } from "../lib/numeric-format"
import { Input } from "./input"

export type NumericInputKind = "money" | "percent" | "quantity"

export interface NumericInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> {
  kind: NumericInputKind
  /** A number, "" when empty, or the typed text when it is not a number yet. */
  value: unknown
  onValueChange: (value: number | string) => void
  /** ISO 4217 code shown before a money amount. */
  currency?: string
  /** Unit of measure shown after a quantity. */
  unit?: string
  /** Fraction digits always shown while not focused; money defaults to 2. Typed precision is kept. */
  decimals?: number
}

const adornmentClass =
  "pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted-foreground select-none"

/**
 * Text input for amounts: accepts locale grouping/decimal separators, shows grouped
 * digits while not focused and never changes value on scroll (no `type="number"`).
 */
export function NumericInput({
  kind,
  value,
  onValueChange,
  currency,
  unit,
  decimals,
  className,
  style,
  onFocus,
  onBlur,
  ...props
}: NumericInputProps) {
  const { i18n } = useTranslation() as { i18n?: { language?: string } }
  const locale = i18n?.language || undefined
  const [draft, setDraft] = useState<string | null>(null)
  const fixedDecimals = decimals ?? (kind === "money" ? 2 : undefined)

  // Prefilled rows may hold "12.5" or a bigint; text that is not a number is shown as typed.
  const numeric = storedNumericValue(value)
  const rawText = typeof value === "string" ? value : ""
  const display = draft ?? (typeof numeric === "number"
    ? formatLocaleNumber(numeric, { locale, decimals: fixedDecimals })
    : rawText)

  const prefix = kind === "money" ? currency?.toUpperCase() : undefined
  const suffix = kind === "percent" ? "%" : kind === "quantity" ? unit : undefined

  return (
    <div className="relative">
      {prefix ? <span className={cn(adornmentClass, "left-3")}>{prefix}</span> : null}
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onFocus={(event) => {
          setDraft(typeof numeric === "number"
            ? formatLocaleNumber(numeric, { locale, grouping: false, maxDecimals: 10 })
            : rawText)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setDraft(null)
          onBlur?.(event)
        }}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          const parsed = parseLocaleNumber(text, locale)
          if (parsed === undefined) onValueChange("")
          else if (parsed === null) onValueChange(text)
          else onValueChange(parsed)
        }}
        style={{
          ...(prefix ? { paddingLeft: `calc(${prefix.length}ch + 1.25rem)` } : {}),
          ...(suffix ? { paddingRight: `calc(${suffix.length}ch + 1.25rem)` } : {}),
          ...style,
        }}
        className={cn("text-right tabular-nums", className)}
      />
      {suffix ? <span className={cn(adornmentClass, "right-3")}>{suffix}</span> : null}
    </div>
  )
}
